// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { INotebookImporter } from '../../client/datascience/types';
import { injectable } from 'inversify';

@injectable()
export class MockJupyterImporter implements INotebookImporter {
    public importFromFile(file: string): Promise<string> {
        return Promise.resolve('#%% Foo');
    }

    // tslint:disable:no-empty
    public dispose() {
    }
}
