// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as path from 'path';
import { Disposable, Event, EventEmitter, Uri } from 'vscode';
import { IFileSystem } from '../common/platform/types';
import { IDisposableRegistry, IPersistentStateFactory, Resource } from '../common/types';
import { createDeferred, Deferred } from '../common/utils/async';
import {
    CONDA_ENV_FILE_SERVICE,
    CONDA_ENV_SERVICE,
    CURRENT_PATH_SERVICE,
    GLOBAL_VIRTUAL_ENV_SERVICE,
    KNOWN_PATH_SERVICE,
    PIPENV_SERVICE,
    WINDOWS_REGISTRY_SERVICE,
    WORKSPACE_VIRTUAL_ENV_SERVICE
} from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';
import { isHiddenInterpreter } from './discovery/locators/services/interpreterFilter';
import { GetEnvironmentLocatorOptions, IEnvironmentLocatorService } from './discovery/locators/types';
import { mergeEnvironments, PartialPythonEnvironment, PythonEnvironment } from './info';
import { IEnvironmentInfoService } from './info/environmentInfoService';
import { isEnvironmentValid, resolvePossibleSymlinkToRealPath } from './utils';

export interface IEnvironmentsCollection {
    readonly onDidChange: Event<void>;
    getEnvironments(
        resource?: Resource,
        options?: GetEnvironmentLocatorOptions | undefined
    ): Promise<(PartialPythonEnvironment | PythonEnvironment)[]>;
    addPath(interpreterPath: string): Promise<void>;
}

const partialInfoEnvironmentMapKey = 'PARTIAL_INFO_ENVIRONMENT_MAP_KEY';
const completeInfoEnvironmentMapKey = 'COMPLETE_INFO_ENVIRONMENT_MAP_KEY';

/**
 * Facilitates locating Python environments.
 */
export class EnvironmentsCollection implements IEnvironmentsCollection {
    public get onDidChange(): Event<void> {
        return this.didChangeCollectionEmitter.event;
    }
    private readonly partialInfoEnvironmentMap: Map<string, PartialPythonEnvironment>;
    private readonly completeInfoEnvironmentMap: Map<string, PythonEnvironment>;

    private readonly persistentStateFactory: IPersistentStateFactory;
    private readonly fileSystem: IFileSystem;
    private readonly environmentsInfo: IEnvironmentInfoService;
    /**
     * Resolved to true if environment storage contains atleast one environment.
     */
    private readonly didEffortToPopulateStorageSucceed: Deferred<boolean>;
    private readonly didChangeCollectionEmitter = new EventEmitter<void>();

    constructor(private serviceContainer: IServiceContainer) {
        this.environmentsInfo = serviceContainer.get<IEnvironmentInfoService>(IEnvironmentInfoService);
        this.persistentStateFactory = serviceContainer.get<IPersistentStateFactory>(IPersistentStateFactory);
        this.fileSystem = serviceContainer.get<IFileSystem>(IFileSystem);
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
        const locators = this.getLocators();
        const disposables = serviceContainer.get<Disposable[]>(IDisposableRegistry);
        locators.forEach((locator) => {
            disposables.push(
                locator.onDidChange((resource) =>
                    this.getEnvironmentsFromLocatorAndStoreIt(locator, resource).ignoreErrors()
                )
            );
        });
    }

    /**
     * Return the list of Python environments as they are discovered. Does its best to return atleast one environment.
     *
     * The optional resource arg may control where locators look for environments.
     */
    public async getEnvironments(
        resource?: Uri,
        options?: GetEnvironmentLocatorOptions
    ): Promise<PartialPythonEnvironment[]> {
        await removeInvalidEntriesFromEnvironmentMaps([
            this.partialInfoEnvironmentMap,
            this.completeInfoEnvironmentMap
        ]);
        const areAllEnvironmentsStoredPromise = this.getEnvironmentsAndStoreIt(resource, options);
        if (options?.getAllEnvironments) {
            // Wait until all discovered environments are stored into storage
            await areAllEnvironmentsStoredPromise;
        }
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

    public async addPath(interpreterPath: string) {
        await this.addPartialInfo({ path: interpreterPath });
    }

    private async addPartialInfo(interpreter: PartialPythonEnvironment, options?: GetEnvironmentLocatorOptions) {
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
        this.didEffortToPopulateStorageSucceed.resolve(true);
    }

    private async getEnvironmentsAndStoreIt(resource?: Uri, options?: GetEnvironmentLocatorOptions) {
        const locators = this.getLocators(options);
        return Promise.all(
            locators.map(async (locator) => this.getEnvironmentsFromLocatorAndStoreIt(locator, resource, options))
        );
    }

    private async getEnvironmentsFromLocatorAndStoreIt(
        locator: IEnvironmentLocatorService,
        resource?: Uri,
        options?: GetEnvironmentLocatorOptions
    ) {
        const environments = await locator.getEnvironments(resource, options);
        return Promise.all(
            environments
                .filter((item) => !isHiddenInterpreter(item))
                .map((interpreter) =>
                    this.addPartialInfo(interpreter, options).then(() => {
                        // It's crucial to resolve this promise as this method waits on this
                        this.didEffortToPopulateStorageSucceed.resolve(true);
                    })
                )
        );
    }

    /**
     * Return the list of applicable interpreter locators.
     */
    private getLocators(options?: GetEnvironmentLocatorOptions): IEnvironmentLocatorService[] {
        // The order is important because the data sources at the bottom of the list do not contain all,
        // the information about the environments (e.g. type, environment name, etc).
        // This way, the items returned from the top of the list will win, when we combine the items returned.
        const keys = [
            WINDOWS_REGISTRY_SERVICE,
            CONDA_ENV_SERVICE,
            CONDA_ENV_FILE_SERVICE,
            PIPENV_SERVICE,
            GLOBAL_VIRTUAL_ENV_SERVICE,
            WORKSPACE_VIRTUAL_ENV_SERVICE,
            KNOWN_PATH_SERVICE,
            CURRENT_PATH_SERVICE
        ];

        const locators = keys.map((item) =>
            this.serviceContainer.get<IEnvironmentLocatorService>(IEnvironmentLocatorService, item[0])
        );

        // Set it to true the first time the user selects an interpreter
        if (options?.onSuggestion === true) {
            locators.forEach((locator) => (locator.didTriggerInterpreterSuggestions = true));
        }

        return locators;
    }
}

async function removeInvalidEntriesFromEnvironmentMaps(maps: Map<string, PartialPythonEnvironment>[]) {
    await Promise.all(
        maps.map((map) => {
            [...map.entries()].map(async ([key, environment]) => {
                const isValid = await isEnvironmentValid(environment);
                if (!isValid) {
                    map.delete(key);
                }
            });
        })
    );
}
