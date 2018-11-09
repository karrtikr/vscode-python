// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { nbformat } from '@jupyterlab/coreutils';
import { JSONObject } from '@phosphor/coreutils';
import { injectable } from 'inversify';
import { Observable } from 'rxjs/Observable';
import * as uuid from 'uuid/v4';
import { Event } from 'vscode';

import { JupyterServerHelper } from '../../client/datascience/jupyterServerHelper';
import { CellState, ICell, INotebookServer } from '../../client/datascience/types';

// tslint:disable:no-empty
@injectable()
export class MockJupyterServer implements INotebookServer {
    public onStatusChanged: Event<boolean>;
    private dict = {};

    constructor() {
        // Create our dummy list of cells for use in returning data
        this.addCodeCell('a=1\r\na', '1');
        this.addMarkdownCell('#%% [markdown]\r\n# #HEADER1', '#HEADER1');
        this.addMarkdownCell('#%% [markdown]\r\n# #HEADER2', '#HEADER2');
        this.addCodeCell('#%% Cell 1\r\nprint("hello")', 'hello');
    }

    public start(notebookFile?: string): Promise<boolean> {
        return Promise.resolve(true);
    }
    public shutdown(): Promise<void> {
        return Promise.resolve();
    }
    public getCurrentState(): Promise<ICell[]> {
        throw new Error('Method not implemented.');
    }
    public executeObservable(code: string, file: string, line: number): Observable<ICell[]> {
        return this.generateObservable(code);
    }
    public execute(code: string, file: string, line: number): Promise<ICell[]> {
        const observable = this.executeObservable(code, file, line);
        return JupyterServerHelper.convertToPromise(observable);
    }
    public restartKernel(): Promise<void> {
        return Promise.resolve();
    }
    public translateToNotebook(cells: ICell[]): Promise<JSONObject> {
        throw new Error('Method not implemented.');
    }
    public launchNotebook(file: string): Promise<boolean> {
        return Promise.resolve(true);
    }
    public waitForIdle(): Promise<void> {
        return Promise.resolve();
    }
    public dispose() {
    }

    private findCell = (code : string) : ICell => {
        if (this.dict.hasOwnProperty(code)) {
            return this.dict[code] as ICell;
        }

        throw new Error(`Cell ${code.splitLines()[0]} not found in mock`);
    }

    private addMarkdownCell(code: string, result: string) {
        const key = JupyterServerHelper.splitForMarkdown(code, 0).first;
        const cell : ICell = {
            data: {
                source:  JupyterServerHelper.extractMarkdown(code),
                cell_type: 'markdown',
                outputs: [],
                metadata: {},
                execution_count: 0
            },
            id: uuid(),
            file: 'foo.py',
            line: 0,
            state: CellState.finished
        };

        // Save in our dictionary
        this.dict[key] = cell;
    }

    private addCodeCell(code: string, result: string, mimeType?: string) {
        const key = JupyterServerHelper.splitForMarkdown(code, 0).first;
        const cell : ICell = {
            data: {
                source: JupyterServerHelper.extractCode(code),
                cell_type: 'code',
                outputs: [],
                metadata: {},
                execution_count: 1
            },
            id: uuid(),
            file: 'foo.py',
            line: 0,
            state: CellState.finished
        };

        // Update outputs based on mime type
        const output : nbformat.IStream = {
            output_type : 'stream',
            name: 'stdout',
            text: result
        };
        output.data = {};
        output.data[mimeType ? mimeType : 'text/plain'] = result;
        const data : nbformat.ICodeCell = cell.data as nbformat.ICodeCell;
        data.outputs = [...data.outputs, output];
        cell.data = data;

        // Save in our dictionary
        this.dict[key] = cell;
    }

    private generateObservable(code: string) : Observable<ICell[]> {
        return new Observable(subscriber => {
            // First split into markdown or code cells
            const splits = JupyterServerHelper.splitForMarkdown(code, 0);

            // Search for each one and stick in an array
            const cells : ICell[] = [];
            cells.push(this.findCell(splits.first));
            if (splits.second) {
                cells.push(this.findCell(splits.second));
            }

            // Do the init response
            const init = cells.map(c => {
                if (c.data.cell_type === 'code') {
                    // code are in the finalized state, eliminate their output and make init
                    const copy = JSON.parse(JSON.stringify(c));
                    copy.data.outputs = [];
                    copy.state = CellState.init;
                    return copy;
                }

                return c;
            })
            subscriber.next(init);

            // Do the execute response
            const execute = cells.filter(c => c.data.cell_type === 'code').map(c => {
                const copy = JSON.parse(JSON.stringify(c));
                copy.data.outputs = [];
                copy.state = CellState.executing;
                return copy;
            });
            if (execute && execute.length) {
                // Wait for a single tick and do our execute
                setTimeout(() => {
                    subscriber.next(execute);
                }, 10);

                // Wait for a single tick and then do our final
                setTimeout(() => {
                    subscriber.next(cells);
                    subscriber.complete();
                }, 10);
            } else {
                subscriber.complete();
            }
        });
    }

}
