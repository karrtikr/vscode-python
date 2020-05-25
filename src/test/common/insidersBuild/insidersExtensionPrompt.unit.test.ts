// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// tslint:disable:no-any

import { anything, instance, mock, verify, when } from 'ts-mockito';
import * as TypeMoq from 'typemoq';
import { Extension } from 'vscode';
import { ApplicationShell } from '../../../client/common/application/applicationShell';
import { CommandManager } from '../../../client/common/application/commandManager';
import { IApplicationShell, ICommandManager } from '../../../client/common/application/types';
import { ExtensionChannelService } from '../../../client/common/insidersBuild/downloadChannelService';
import {
    InsidersExtensionPrompt,
    insidersPromptStateKey
} from '../../../client/common/insidersBuild/insidersExtensionPrompt';
import { ExtensionChannel, IExtensionChannelService } from '../../../client/common/insidersBuild/types';
import { PersistentStateFactory } from '../../../client/common/persistentState';
import { IExtensions, IPersistentState, IPersistentStateFactory } from '../../../client/common/types';
import { Common, DataScienceSurveyBanner, ExtensionChannels } from '../../../client/common/utils/localize';
import { PVSC_EXTENSION_ID_FOR_TESTS } from '../../constants';

// tslint:disable-next-line: max-func-body-length
suite('Insiders Extension prompt', () => {
    let appShell: IApplicationShell;
    let extensionChannelService: IExtensionChannelService;
    let cmdManager: ICommandManager;
    let persistentState: IPersistentStateFactory;
    let hasUserBeenNotifiedState: TypeMoq.IMock<IPersistentState<boolean>>;
    let extensions: TypeMoq.IMock<IExtensions>;
    let insidersPrompt: InsidersExtensionPrompt;
    let extension: TypeMoq.IMock<Extension<any>>;
    setup(() => {
        extensionChannelService = mock(ExtensionChannelService);
        appShell = mock(ApplicationShell);
        persistentState = mock(PersistentStateFactory);
        cmdManager = mock(CommandManager);
        hasUserBeenNotifiedState = TypeMoq.Mock.ofType<IPersistentState<boolean>>();
        extensions = TypeMoq.Mock.ofType<IExtensions>();
        extension = TypeMoq.Mock.ofType<Extension<any>>();
        extensions.setup((e) => e.getExtension(PVSC_EXTENSION_ID_FOR_TESTS)).returns(() => extension.object);
        extension.setup((e) => e.packageJSON).returns(() => ({ featureFlags: { oneVSIX: true } }));
        when(persistentState.createGlobalPersistentState(insidersPromptStateKey, false)).thenReturn(
            hasUserBeenNotifiedState.object
        );
        insidersPrompt = new InsidersExtensionPrompt(
            instance(appShell),
            instance(extensionChannelService),
            instance(cmdManager),
            instance(persistentState),
            extensions.object
        );
    });

    test('If oneVSIX flag is not set, do not show prompt to install insiders', async () => {
        const prompts = [
            ExtensionChannels.yesWeekly(),
            ExtensionChannels.yesDaily(),
            DataScienceSurveyBanner.bannerLabelNo()
        ];
        extension.reset();
        extension.setup((e) => e.packageJSON).returns(() => ({ featureFlags: {} }));
        await insidersPrompt.promptToInstallInsiders();
        verify(appShell.showInformationMessage(ExtensionChannels.promptMessage(), ...prompts)).never();
    });

    test("Channel is set to 'daily' if 'Yes, daily' option is selected", async () => {
        const prompts = [
            ExtensionChannels.yesWeekly(),
            ExtensionChannels.yesDaily(),
            DataScienceSurveyBanner.bannerLabelNo()
        ];
        when(appShell.showInformationMessage(ExtensionChannels.promptMessage(), ...prompts)).thenResolve(
            ExtensionChannels.yesDaily() as any
        );
        when(cmdManager.executeCommand('workbench.action.reloadWindow')).thenResolve();
        when(extensionChannelService.updateChannel(ExtensionChannel.daily)).thenResolve();
        hasUserBeenNotifiedState
            .setup((u) => u.updateValue(true))
            .returns(() => Promise.resolve(undefined))
            .verifiable(TypeMoq.Times.once());
        await insidersPrompt.promptToInstallInsiders();
        verify(appShell.showInformationMessage(ExtensionChannels.promptMessage(), ...prompts)).once();
        verify(extensionChannelService.updateChannel(ExtensionChannel.daily)).once();
        hasUserBeenNotifiedState.verifyAll();
        verify(cmdManager.executeCommand('workbench.action.reloadWindow')).never();
    });

    test("Channel is set to 'weekly' if 'Yes, weekly' option is selected", async () => {
        const prompts = [
            ExtensionChannels.yesWeekly(),
            ExtensionChannels.yesDaily(),
            DataScienceSurveyBanner.bannerLabelNo()
        ];
        when(appShell.showInformationMessage(ExtensionChannels.promptMessage(), ...prompts)).thenResolve(
            ExtensionChannels.yesWeekly() as any
        );
        when(cmdManager.executeCommand('workbench.action.reloadWindow')).thenResolve();
        when(extensionChannelService.updateChannel(ExtensionChannel.weekly)).thenResolve();
        hasUserBeenNotifiedState
            .setup((u) => u.updateValue(true))
            .returns(() => Promise.resolve(undefined))
            .verifiable(TypeMoq.Times.once());
        await insidersPrompt.promptToInstallInsiders();
        verify(appShell.showInformationMessage(ExtensionChannels.promptMessage(), ...prompts)).once();
        verify(extensionChannelService.updateChannel(ExtensionChannel.weekly)).once();
        hasUserBeenNotifiedState.verifyAll();
        verify(cmdManager.executeCommand('workbench.action.reloadWindow')).never();
    });

    test("No channel is set if 'No, thanks' option is selected", async () => {
        const prompts = [
            ExtensionChannels.yesWeekly(),
            ExtensionChannels.yesDaily(),
            DataScienceSurveyBanner.bannerLabelNo()
        ];
        when(appShell.showInformationMessage(ExtensionChannels.promptMessage(), ...prompts)).thenResolve(
            DataScienceSurveyBanner.bannerLabelNo() as any
        );
        when(cmdManager.executeCommand('workbench.action.reloadWindow')).thenResolve();
        when(extensionChannelService.updateChannel(anything())).thenResolve();
        hasUserBeenNotifiedState
            .setup((u) => u.updateValue(true))
            .returns(() => Promise.resolve(undefined))
            .verifiable(TypeMoq.Times.once());
        await insidersPrompt.promptToInstallInsiders();
        verify(appShell.showInformationMessage(ExtensionChannels.promptMessage(), ...prompts)).once();
        verify(extensionChannelService.updateChannel(anything())).never();
        hasUserBeenNotifiedState.verifyAll();
        verify(cmdManager.executeCommand('workbench.action.reloadWindow')).never();
    });

    test('No channel is set if no option is selected', async () => {
        const prompts = [
            ExtensionChannels.yesWeekly(),
            ExtensionChannels.yesDaily(),
            DataScienceSurveyBanner.bannerLabelNo()
        ];
        when(appShell.showInformationMessage(ExtensionChannels.promptMessage(), ...prompts)).thenResolve(
            undefined as any
        );
        when(cmdManager.executeCommand('workbench.action.reloadWindow')).thenResolve();
        when(extensionChannelService.updateChannel(anything())).thenResolve();
        hasUserBeenNotifiedState
            .setup((u) => u.updateValue(true))
            .returns(() => Promise.resolve(undefined))
            .verifiable(TypeMoq.Times.once());
        await insidersPrompt.promptToInstallInsiders();
        verify(appShell.showInformationMessage(ExtensionChannels.promptMessage(), ...prompts)).once();
        verify(extensionChannelService.updateChannel(anything())).never();
        hasUserBeenNotifiedState.verifyAll();
        verify(cmdManager.executeCommand('workbench.action.reloadWindow')).never();
    });

    test('Do not do anything if no option is selected in the reload prompt', async () => {
        when(
            appShell.showInformationMessage(ExtensionChannels.reloadToUseInsidersMessage(), Common.reload())
        ).thenResolve(undefined);
        when(cmdManager.executeCommand('workbench.action.reloadWindow')).thenResolve();
        await insidersPrompt.promptToReload();
        verify(appShell.showInformationMessage(ExtensionChannels.reloadToUseInsidersMessage(), Common.reload())).once();
        verify(cmdManager.executeCommand('workbench.action.reloadWindow')).never();
    });

    test("Reload windows if 'Reload' option is selected in the reload prompt", async () => {
        when(
            appShell.showInformationMessage(ExtensionChannels.reloadToUseInsidersMessage(), Common.reload())
        ).thenResolve(Common.reload() as any);
        when(cmdManager.executeCommand('workbench.action.reloadWindow')).thenResolve();
        await insidersPrompt.promptToReload();
        verify(appShell.showInformationMessage(ExtensionChannels.reloadToUseInsidersMessage(), Common.reload())).once();
        verify(cmdManager.executeCommand('workbench.action.reloadWindow')).once();
    });
});
