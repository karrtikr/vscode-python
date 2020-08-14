import { Disposable, Event, Uri } from 'vscode';
import { Resource } from '../../../common/types';
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { GetInterpreterOptions } from '../../../interpreter/interpreterService';
import { PythonEnvironment } from '../../info';

export type GetInterpreterLocatorOptions = GetInterpreterOptions & { ignoreCache?: boolean };

export type GetEnvironmentLocatorOptions = GetInterpreterOptions & {
    ignoreCache?: boolean;
    getAllEnvironments?: boolean;
    getCompleteInfoForAllEnvironments?: boolean;
};

export const IEnvironmentLocatorService = Symbol('IEnvironmentLocatorService');
export interface IEnvironmentLocatorService extends Disposable {
    readonly onLocating: Event<Promise<PythonEnvironment[]>>;
    readonly hasInterpreters: Promise<boolean>;
    onDidChange: Event<Resource>;
    didTriggerInterpreterSuggestions?: boolean;
    getEnvironments(resource?: Uri, options?: GetEnvironmentLocatorOptions): Promise<PythonEnvironment[]>;
}
