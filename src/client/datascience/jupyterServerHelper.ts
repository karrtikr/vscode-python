// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../common/extensions';
import { Observable } from 'rxjs/Observable';
import { ICell, CellState } from './types';
import { RegExpValues } from './constants';
import { createDeferred } from '../common/utils/async';

// Helper methods shared between JupyterServer and MockJupyterServer
export class JupyterServerHelper {

    private static appendLineFeed(arr : string[], modifier? : (s : string) => string) {
        return arr.map((s: string, i: number) => {
            const out = modifier ? modifier(s) : s;
            return i === arr.length - 1 ? `${out}` : `${out}\n`;
        });
    }

    public static extractMarkdown(code: string) : string[] {
        return JupyterServerHelper.appendLineFeed(code.split('\n').slice(1), s => s.trim().slice(1).trim());
    }

    public static extractCode(code: string) : string[] {
        return JupyterServerHelper.appendLineFeed(code.split('\n'));
    }

    public static splitForMarkdown(code: string, line: number) : { hasMarkdown: boolean, first: string, second?: string, secondLineOffset?: number } {
        // Determine if we have a markdown cell/ markdown and code cell combined/ or just a code cell
        const copy = code.replace(/\r\n/g, '\n');
        const split = code.splitLines();
        const firstLine = split.length > 0 ? split[0] : undefined;
        if (firstLine && RegExpValues.PythonMarkdownCellMarker.test(firstLine)) {
            // We have at least one markdown. We might have to split it if there any lines that don't begin
            // with #
            const firstNonMarkdown = split.findIndex((l: string) => l.trim().length > 0 && !l.trim().startsWith('#'));
            return {
                hasMarkdown: true,
                first: firstNonMarkdown > 0 ? split.slice(0, firstNonMarkdown).join('\n') : copy,
                second: firstNonMarkdown > 0 ?  split.slice(firstNonMarkdown).join('\n') : undefined,
                secondLineOffset: firstNonMarkdown > 0 ? firstNonMarkdown : undefined
            };
        } else {
            return {
                hasMarkdown: false,
                first: copy
            }
        }
    }

    public static convertToPromise<T>(observable: Observable<T>) : Promise<T> {
        // Create a deferred that we'll fire when we're done
        const deferred = createDeferred<T>();

        let output: T;

        observable.subscribe(
            (next: T) => {
                output = next;
            },
            (error) => {
                deferred.reject(error);
            },
            () => {
                deferred.resolve(output);
            });

        return deferred.promise;
    }

    public static combineObservables(...args : Observable<ICell>[]) : Observable<ICell[]> {
        return new Observable<ICell[]>(subscriber => {
            // When all complete, we have our results
            const results : { [id : string] : ICell } = {};

            args.forEach(o => {
                o.subscribe(c => {
                    results[c.id] = c;

                    // Convert to an array
                    const array = Object.keys(results).map((k : string) => {
                        return results[k];
                    });

                    // Update our subscriber of our total results if we have that many
                    if (array.length === args.length) {
                        subscriber.next(array);

                        // Complete when everybody is finished
                        if (array.every(a => a.state === CellState.finished || a.state === CellState.error)) {
                            subscriber.complete();
                        }
                    }
                },
                e => {
                    subscriber.error(e);
                });
            });
        });
    }

}
