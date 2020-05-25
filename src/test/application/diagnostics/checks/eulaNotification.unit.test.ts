// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// tslint:disable:max-func-body-length no-any max-classes-per-file

import { assert, expect } from 'chai';
import * as typemoq from 'typemoq';
import { DiagnosticSeverity, Uri } from 'vscode';
import { BaseDiagnostic, BaseDiagnosticsService } from '../../../../client/application/diagnostics/base';
import {
    EulaDiagnostic,
    EulaDiagnosticService,
    extensionLicenseURI,
    newEulaDiagnosticPromptKey
} from '../../../../client/application/diagnostics/checks/eulaNotification';
import { CommandOption, IDiagnosticsCommandFactory } from '../../../../client/application/diagnostics/commands/types';
import { DiagnosticCodes } from '../../../../client/application/diagnostics/constants';
import {
    DiagnosticCommandPromptHandlerServiceId,
    MessageCommandPrompt
} from '../../../../client/application/diagnostics/promptHandler';
import {
    DiagnosticScope,
    IDiagnostic,
    IDiagnosticCommand,
    IDiagnosticFilterService,
    IDiagnosticHandlerService
} from '../../../../client/application/diagnostics/types';
import { IWorkspaceService } from '../../../../client/common/application/types';
import {
    IDisposableRegistry,
    IPersistentState,
    IPersistentStateFactory,
    Resource
} from '../../../../client/common/types';
import { Common, Diagnostics } from '../../../../client/common/utils/localize';
import { IServiceContainer } from '../../../../client/ioc/types';

suite('Application Diagnostics - Eula notification', () => {
    const resource = Uri.parse('a');
    let diagnosticService: EulaDiagnosticService;
    let messageHandler: typemoq.IMock<IDiagnosticHandlerService<MessageCommandPrompt>>;
    let commandFactory: typemoq.IMock<IDiagnosticsCommandFactory>;
    let persistentStateFactory: typemoq.IMock<IPersistentStateFactory>;
    let workspaceService: typemoq.IMock<IWorkspaceService>;
    let filterService: typemoq.IMock<IDiagnosticFilterService>;
    let serviceContainer: typemoq.IMock<IServiceContainer>;
    function createContainer() {
        workspaceService = typemoq.Mock.ofType<IWorkspaceService>();
        serviceContainer = typemoq.Mock.ofType<IServiceContainer>();
        persistentStateFactory = typemoq.Mock.ofType<IPersistentStateFactory>();
        filterService = typemoq.Mock.ofType<IDiagnosticFilterService>();
        messageHandler = typemoq.Mock.ofType<IDiagnosticHandlerService<MessageCommandPrompt>>();
        serviceContainer
            .setup((s) =>
                s.get(
                    typemoq.It.isValue(IDiagnosticHandlerService),
                    typemoq.It.isValue(DiagnosticCommandPromptHandlerServiceId)
                )
            )
            .returns(() => messageHandler.object);
        commandFactory = typemoq.Mock.ofType<IDiagnosticsCommandFactory>();
        serviceContainer
            .setup((s) => s.get(typemoq.It.isValue(IDiagnosticFilterService)))
            .returns(() => filterService.object);
        serviceContainer
            .setup((s) => s.get(typemoq.It.isValue(IDiagnosticsCommandFactory)))
            .returns(() => commandFactory.object);
        serviceContainer
            .setup((s) => s.get(typemoq.It.isValue(IWorkspaceService)))
            .returns(() => workspaceService.object);
        serviceContainer.setup((s) => s.get(typemoq.It.isValue(IDisposableRegistry))).returns(() => []);
        return serviceContainer.object;
    }
    suite('Diagnostics', () => {
        setup(() => {
            diagnosticService = new (class extends EulaDiagnosticService {
                public _clear() {
                    while (BaseDiagnosticsService.handledDiagnosticCodeKeys.length > 0) {
                        BaseDiagnosticsService.handledDiagnosticCodeKeys.shift();
                    }
                }
            })(createContainer(), messageHandler.object, [], persistentStateFactory.object);
            (diagnosticService as any)._clear();
        });

        test('Can handle EulaDiagnostic diagnostics', async () => {
            const diagnostic = typemoq.Mock.ofType<IDiagnostic>();
            diagnostic
                .setup((d) => d.code)
                .returns(() => DiagnosticCodes.EulaDiagnostic)
                .verifiable(typemoq.Times.atLeastOnce());

            const canHandle = await diagnosticService.canHandle(diagnostic.object);
            expect(canHandle).to.be.equal(true, `Should be able to handle ${DiagnosticCodes.EulaDiagnostic}`);
            diagnostic.verifyAll();
        });

        test('Can not handle non-EulaDiagnostic diagnostics', async () => {
            const diagnostic = typemoq.Mock.ofType<IDiagnostic>();
            diagnostic
                .setup((d) => d.code)
                .returns(() => 'Something Else' as any)
                .verifiable(typemoq.Times.atLeastOnce());

            const canHandle = await diagnosticService.canHandle(diagnostic.object);
            expect(canHandle).to.be.equal(false, 'Invalid value');
            diagnostic.verifyAll();
        });

        test('Should not display a message if the diagnostic code has been ignored', async () => {
            const diagnostic = typemoq.Mock.ofType<IDiagnostic>();

            filterService
                .setup((f) => f.shouldIgnoreDiagnostic(typemoq.It.isValue(DiagnosticCodes.EulaDiagnostic)))
                .returns(() => Promise.resolve(true))
                .verifiable(typemoq.Times.once());
            diagnostic
                .setup((d) => d.code)
                .returns(() => DiagnosticCodes.EulaDiagnostic)
                .verifiable(typemoq.Times.atLeastOnce());
            commandFactory
                .setup((f) => f.createCommand(typemoq.It.isAny(), typemoq.It.isAny()))
                .verifiable(typemoq.Times.never());
            messageHandler
                .setup((m) => m.handle(typemoq.It.isAny(), typemoq.It.isAny()))
                .verifiable(typemoq.Times.never());

            await diagnosticService.handle([diagnostic.object]);

            filterService.verifyAll();
            diagnostic.verifyAll();
            commandFactory.verifyAll();
            messageHandler.verifyAll();
        });

        test('EulaDiagnostic is handled as expected', async () => {
            const diagnostic = new EulaDiagnostic('message', resource);
            const launchCmd = ({ cmd: 'launchCmd' } as any) as IDiagnosticCommand;
            filterService
                .setup((f) => f.shouldIgnoreDiagnostic(typemoq.It.isValue(DiagnosticCodes.EulaDiagnostic)))
                .returns(() => Promise.resolve(false));
            let messagePrompt: MessageCommandPrompt | undefined;
            messageHandler
                .setup((i) => i.handle(typemoq.It.isValue(diagnostic), typemoq.It.isAny()))
                .callback((_d, p: MessageCommandPrompt) => (messagePrompt = p))
                .returns(() => Promise.resolve())
                .verifiable(typemoq.Times.once());

            commandFactory
                .setup((f) =>
                    f.createCommand(
                        typemoq.It.isAny(),
                        typemoq.It.isObjectWith<CommandOption<'launch', string>>({
                            type: 'launch',
                            options: extensionLicenseURI
                        })
                    )
                )
                .returns(() => launchCmd)
                .verifiable(typemoq.Times.once());

            await diagnosticService.handle([diagnostic]);

            messageHandler.verifyAll();
            commandFactory.verifyAll();
            expect(messagePrompt).not.be.equal(undefined, 'Message prompt not set');
            expect(messagePrompt!.commandPrompts.length).to.equal(2, 'Incorrect length');
            expect(messagePrompt!.commandPrompts[0]).to.be.deep.equal({
                prompt: Diagnostics.viewLicense(),
                command: launchCmd
            });
            expect(messagePrompt!.commandPrompts[1]).to.be.deep.equal({
                prompt: Common.close()
            });
        });

        test('Handling an empty diagnostic should not show a message nor return a command', async () => {
            const diagnostics: IDiagnostic[] = [];

            messageHandler
                .setup((i) => i.handle(typemoq.It.isAny(), typemoq.It.isAny()))
                .callback((_d, p: MessageCommandPrompt) => p)
                .returns(() => Promise.resolve())
                .verifiable(typemoq.Times.never());
            commandFactory
                .setup((f) => f.createCommand(typemoq.It.isAny(), typemoq.It.isAny()))
                .verifiable(typemoq.Times.never());

            await diagnosticService.handle(diagnostics);

            messageHandler.verifyAll();
            commandFactory.verifyAll();
        });

        test('Handling an unsupported diagnostic code should not show a message nor return a command', async () => {
            const diagnostic = new (class SomeRandomDiagnostic extends BaseDiagnostic {
                constructor(message: string, uri: Resource) {
                    super(
                        'SomeRandomDiagnostic' as any,
                        message,
                        DiagnosticSeverity.Information,
                        DiagnosticScope.WorkspaceFolder,
                        uri
                    );
                }
            })('message', undefined);
            messageHandler
                .setup((i) => i.handle(typemoq.It.isAny(), typemoq.It.isAny()))
                .callback((_d, p: MessageCommandPrompt) => p)
                .returns(() => Promise.resolve())
                .verifiable(typemoq.Times.never());
            commandFactory
                .setup((f) => f.createCommand(typemoq.It.isAny(), typemoq.It.isAny()))
                .verifiable(typemoq.Times.never());

            await diagnosticService.handle([diagnostic]);

            messageHandler.verifyAll();
            commandFactory.verifyAll();
        });

        test('If notification has already been displayed once, return empty diagnostics', async () => {
            const persistentState = typemoq.Mock.ofType<IPersistentState<boolean>>();
            persistentStateFactory
                .setup((p) => p.createGlobalPersistentState(newEulaDiagnosticPromptKey, true))
                .returns(() => persistentState.object);
            persistentState.setup((p) => p.value).returns(() => false);

            const diagnostics = await diagnosticService.diagnose(resource);

            assert.deepEqual(diagnostics, []);
        });

        test('If notification has not been displayed before, return appropriate diagnostics and update storage', async () => {
            const persistentState = typemoq.Mock.ofType<IPersistentState<boolean>>();
            persistentStateFactory
                .setup((p) => p.createGlobalPersistentState(newEulaDiagnosticPromptKey, true))
                .returns(() => persistentState.object);
            persistentState.setup((p) => p.value).returns(() => true);
            persistentState
                .setup((p) => p.updateValue(false))
                .returns(() => Promise.resolve())
                .verifiable(typemoq.Times.once());

            const diagnostics = await diagnosticService.diagnose(resource);

            expect(diagnostics.length).to.equal(1);
            expect(diagnostics[0].message).to.equal(Diagnostics.eulaNotification());
            expect(diagnostics[0].resource).to.equal(resource);
            persistentState.verifyAll();
        });
    });
});
