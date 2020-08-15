// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { Disposable, Event, Uri } from 'vscode';
import { IFileSystem } from '../common/platform/types';
import { IDisposableRegistry, IPersistentStateFactory, Resource } from '../common/types';
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
import { PartialPythonEnvironment, PythonEnvironment } from './info';
import { IEnvironmentInfoService } from './info/environmentInfoService';
import { EnvironmentsStorage } from './info/environmentsStorage';

export interface IEnvironmentsCollection {
    readonly onDidChange: Event<void>;
    getEnvironments(
        resource?: Resource,
        options?: GetEnvironmentLocatorOptions | undefined
    ): Promise<(PartialPythonEnvironment | PythonEnvironment)[]>;
    addPath(interpreterPath: string): Promise<void>;
}

/**
 * Facilitates locating Python environments.
 */
export class EnvironmentsCollection implements IEnvironmentsCollection {
    public get onDidChange(): Event<void> {
        return this.environmentsStorage.onDidChange;
    }

    private readonly persistentStateFactory: IPersistentStateFactory;
    private readonly environmentsStorage: EnvironmentsStorage;
    private readonly fileSystem: IFileSystem;
    private readonly environmentsInfo: IEnvironmentInfoService;

    constructor(private serviceContainer: IServiceContainer) {
        this.environmentsInfo = serviceContainer.get<IEnvironmentInfoService>(IEnvironmentInfoService);
        this.fileSystem = serviceContainer.get<IFileSystem>(IFileSystem);
        this.persistentStateFactory = serviceContainer.get<IPersistentStateFactory>(IPersistentStateFactory);
        this.environmentsStorage = new EnvironmentsStorage(
            this.persistentStateFactory,
            this.environmentsInfo,
            this.fileSystem
        );
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
        const areAllEnvironmentsStoredPromise = this.getEnvironmentsAndStoreIt(resource, options);
        if (options?.getAllEnvironments) {
            // Wait until all discovered environments are stored into storage
            await areAllEnvironmentsStoredPromise;
        }
        return this.environmentsStorage.getEnvironments(areAllEnvironmentsStoredPromise);
    }

    public async addPath(interpreterPath: string) {
        await this.environmentsStorage.addPartialInfo({ path: interpreterPath });
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
                .map((interpreter) => this.environmentsStorage.addPartialInfo(interpreter, options))
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
