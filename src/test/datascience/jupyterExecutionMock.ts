// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { ExecutionResult, ObservableExecutionResult, SpawnOptions } from '../../client/common/process/types';
import { IJupyterExecution } from '../../client/datascience/types';
import { injectable } from 'inversify';

@injectable()
export class MockJupyterExecution implements IJupyterExecution {
    public isNotebookSupported(): Promise<boolean> {
        return Promise.resolve(true);
    }

    public isImportSupported(): Promise<boolean> {
        return Promise.resolve(true);
    }
    public execModuleObservable(args: string[], options: SpawnOptions): Promise<ObservableExecutionResult<string>> {
        throw new Error('Method not implemented.');
    }
    public execModule(args: string[], options: SpawnOptions): Promise<ExecutionResult<string>> {
        throw new Error('Method not implemented.');
    }
}
