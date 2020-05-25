// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, named } from 'inversify';
import { DiagnosticSeverity } from 'vscode';
import { IDisposableRegistry, IPersistentStateFactory, Resource } from '../../../common/types';
import { Common, Diagnostics } from '../../../common/utils/localize';
import { IServiceContainer } from '../../../ioc/types';
import { BaseDiagnostic, BaseDiagnosticsService } from '../base';
import { IDiagnosticsCommandFactory } from '../commands/types';
import { DiagnosticCodes } from '../constants';
import { DiagnosticCommandPromptHandlerServiceId, MessageCommandPrompt } from '../promptHandler';
import { DiagnosticScope, IDiagnostic, IDiagnosticHandlerService } from '../types';

export class EulaDiagnostic extends BaseDiagnostic {
    constructor(message: string, resource: Resource) {
        super(
            DiagnosticCodes.EulaDiagnostic,
            message,
            DiagnosticSeverity.Information,
            DiagnosticScope.Global,
            resource
        );
    }
}

export const EulaDiagnosticServiceId = 'EulaDiagnosticServiceId';
export const newEulaDiagnosticPromptKey = 'newEulaDiagnosticPromptKey';
export const extensionLicenseURI = 'https://raw.githubusercontent.com/microsoft/vscode-python/master/LICENSE';

export class EulaDiagnosticService extends BaseDiagnosticsService {
    constructor(
        @inject(IServiceContainer) serviceContainer: IServiceContainer,
        @inject(IDiagnosticHandlerService)
        @named(DiagnosticCommandPromptHandlerServiceId)
        protected readonly messageService: IDiagnosticHandlerService<MessageCommandPrompt>,
        @inject(IDisposableRegistry) disposableRegistry: IDisposableRegistry,
        @inject(IPersistentStateFactory) private readonly persistentStateFactory: IPersistentStateFactory
    ) {
        super([DiagnosticCodes.EulaDiagnostic], serviceContainer, disposableRegistry, true);
    }
    public async diagnose(resource: Resource): Promise<IDiagnostic[]> {
        const notificationPromptEnabled = this.persistentStateFactory.createGlobalPersistentState(
            newEulaDiagnosticPromptKey,
            true
        );
        if (!notificationPromptEnabled.value) {
            return [];
        }
        await notificationPromptEnabled.updateValue(false);
        return [new EulaDiagnostic(Diagnostics.eulaNotification(), resource)];
    }

    protected async onHandle(diagnostics: IDiagnostic[]): Promise<void> {
        if (diagnostics.length === 0 || !(await this.canHandle(diagnostics[0]))) {
            return;
        }
        const diagnostic = diagnostics[0];
        if (await this.filterService.shouldIgnoreDiagnostic(diagnostic.code)) {
            return;
        }
        const commandFactory = this.serviceContainer.get<IDiagnosticsCommandFactory>(IDiagnosticsCommandFactory);
        const options = [
            {
                prompt: Diagnostics.viewLicense(),
                command: commandFactory.createCommand(diagnostic, {
                    type: 'launch',
                    options: extensionLicenseURI
                })
            },
            {
                prompt: Common.close()
            }
        ];

        await this.messageService.handle(diagnostic, { commandPrompts: options });
    }
}
