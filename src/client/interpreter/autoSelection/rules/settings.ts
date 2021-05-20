// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { IWorkspaceService } from '../../../common/application/types';
import { DeprecatePythonPath } from '../../../common/experiments/groups';
import { IFileSystem } from '../../../common/platform/types';
import { IExperimentsManager, IPersistentStateFactory, Resource } from '../../../common/types';
import { AutoSelectionRule, IInterpreterAutoSelectionService } from '../types';
import { BaseRuleService, NextAction } from './baseRule';

@injectable()
export class SettingsInterpretersAutoSelectionRule extends BaseRuleService {
    constructor(
        @inject(IFileSystem) fs: IFileSystem,
        @inject(IPersistentStateFactory) stateFactory: IPersistentStateFactory,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IExperimentsManager) private readonly experiments: IExperimentsManager,
    ) {
        super(AutoSelectionRule.settings, fs, stateFactory);
    }
    protected async onAutoSelectInterpreter(
        resource: Resource,
        _manager?: IInterpreterAutoSelectionService,
    ): Promise<NextAction> {
        const pythonConfig = this.workspaceService.getConfiguration('python', resource)!;
        const pythonPathInConfig = this.experiments.inExperiment(DeprecatePythonPath.experiment)
            ? pythonConfig.get<string>('defaultInterpreterPath')
            : pythonConfig.inspect<string>('pythonPath')?.globalValue;
        this.experiments.sendTelemetryIfInExperiment(DeprecatePythonPath.control);
        // No need to store python paths defined in settings in our caches, they can be retrieved from the settings directly.
        return pythonPathInConfig && pythonPathInConfig !== 'python' ? NextAction.exit : NextAction.runNextRule;
    }
}
