// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as path from 'path';
import { Event, EventEmitter } from 'vscode';
import { mergeEnvironments, PartialPythonEnvironment, PythonEnvironment } from '.';
import { IFileSystem } from '../../common/platform/types';
import { IPersistentStateFactory } from '../../common/types';
import { createDeferred, Deferred } from '../../common/utils/async';
import { GetEnvironmentLocatorOptions } from '../discovery/locators/types';
import { isEnvironmentValid, resolvePossibleSymlinkToRealPath } from '../utils';
import { IEnvironmentInfoService } from './environmentInfoService';

const partialInfoEnvironmentMapKey = 'PARTIAL_INFO_ENVIRONMENT_MAP_KEY';
const completeInfoEnvironmentMapKey = 'COMPLETE_INFO_ENVIRONMENT_MAP_KEY';

export class EnvironmentsStorage {
    public get onDidChange(): Event<void> {
        return this.didChangeCollectionEmitter.event;
    }
    private readonly partialInfoEnvironmentMap: Map<string, PartialPythonEnvironment>;
    private readonly completeInfoEnvironmentMap: Map<string, PythonEnvironment>;
    /**
     * Resolved to true if environment storage contains atleast one environment.
     */
    private readonly didEffortToPopulateStorageSucceed: Deferred<boolean>;
    private readonly didChangeCollectionEmitter = new EventEmitter<void>();

    constructor(
        private readonly persistentStateFactory: IPersistentStateFactory,
        private readonly environmentsInfo: IEnvironmentInfoService,
        private readonly fileSystem: IFileSystem
    ) {
        this.partialInfoEnvironmentMap = this.persistentStateFactory.createGlobalPersistentState(
            partialInfoEnvironmentMapKey,
            new Map<string, PartialPythonEnvironment>()
        ).value;
        this.completeInfoEnvironmentMap = this.persistentStateFactory.createGlobalPersistentState(
            completeInfoEnvironmentMapKey,
            new Map<string, PythonEnvironment>()
        ).value;
        this.didEffortToPopulateStorageSucceed = createDeferred<boolean>();
        if (this.partialInfoEnvironmentMap.size > 0 || this.completeInfoEnvironmentMap.size > 0) {
            this.didEffortToPopulateStorageSucceed.resolve(true);
        }
    }

    /**
     * Returns environments from storage. Does its best to return atleast one environment.
     * @param areAllEnvironmentsStoredPromise A promise which resolves when all environments are discovered and stored
     */
    public async getEnvironments(areAllEnvironmentsStoredPromise: Promise<void[][]>) {
        await this.removeInvalidEntriesFromStorage();
        // Do best effort to return atleast one environment, return an empty list only if no environments are discovered.
        await Promise.race([
            this.didEffortToPopulateStorageSucceed.promise,
            areAllEnvironmentsStoredPromise.then(() => {
                if (!this.didEffortToPopulateStorageSucceed.completed) {
                    // Storage still does not contain environments, it means no environments were discovered.
                    this.didEffortToPopulateStorageSucceed.resolve(false);
                }
            })
        ]);

        const items = [...this.partialInfoEnvironmentMap.values(), ...this.completeInfoEnvironmentMap.values()];
        return mergeEnvironments(items, this.fileSystem);
    }

    public async addPartialInfo(interpreter: PartialPythonEnvironment, options?: GetEnvironmentLocatorOptions) {
        interpreter.path = path.normalize(resolvePossibleSymlinkToRealPath(interpreter.path));
        if (this.completeInfoEnvironmentMap.has(interpreter.path)) {
            return;
        }
        const environmentInfoPromise = this.environmentsInfo.getEnvironmentInfo(interpreter.path);
        if (this.partialInfoEnvironmentMap.has(interpreter.path)) {
            const storedValue = this.partialInfoEnvironmentMap.get(interpreter.path)!;
            interpreter = mergeEnvironments([storedValue, interpreter], this.fileSystem)[0];
        }

        const storeCompleteInfoPromise = environmentInfoPromise.then(async (environmentInfo) => {
            if (environmentInfo) {
                const completeEnvironmentInfo = mergeEnvironments(
                    [environmentInfo, interpreter],
                    this.fileSystem
                )[0] as PythonEnvironment;
                this.completeInfoEnvironmentMap.set(interpreter.path, completeEnvironmentInfo);
            }
            if (this.partialInfoEnvironmentMap.has(interpreter.path)) {
                this.partialInfoEnvironmentMap.delete(interpreter.path);
            }
            this.didChangeCollectionEmitter.fire();
        });

        if (options?.getCompleteInfoForAllEnvironments) {
            await storeCompleteInfoPromise;
        } else {
            // Add to partial environment storage only if the option to getCompleteInfo is not set
            this.partialInfoEnvironmentMap.set(interpreter.path, interpreter);
            this.didChangeCollectionEmitter.fire();
        }
        // It's crucial to resolve this promise
        this.didEffortToPopulateStorageSucceed.resolve(true);
    }

    private async removeInvalidEntriesFromStorage() {
        return Promise.all(
            [this.partialInfoEnvironmentMap, this.completeInfoEnvironmentMap].map((map) => {
                [...map.entries()].map(async ([key, environment]) => {
                    const isValid = await isEnvironmentValid(environment);
                    if (!isValid) {
                        map.delete(key);
                    }
                });
            })
        );
    }
}
