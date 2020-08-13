// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as path from 'path';
import { Disposable, Event, EventEmitter, Uri } from 'vscode';
import { IFileSystem, IPlatformService } from '../../common/platform/types';
import { IDisposableRegistry, IPersistentStateFactory, Resource } from '../../common/types';
import { createDeferred, Deferred } from '../../common/utils/async';
import { OSType } from '../../common/utils/platform';
import {
    CONDA_ENV_FILE_SERVICE,
    CONDA_ENV_SERVICE,
    CURRENT_PATH_SERVICE,
    GLOBAL_VIRTUAL_ENV_SERVICE,
    IInterpreterLocatorHelper,
    KNOWN_PATH_SERVICE,
    PIPENV_SERVICE,
    WINDOWS_REGISTRY_SERVICE,
    WORKSPACE_VIRTUAL_ENV_SERVICE
} from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { isHiddenInterpreter } from '../discovery/locators/services/interpreterFilter';
import { GetInterpreterLocatorOptions, PartialPythonEnvironment } from '../discovery/locators/types';
import { PythonInterpreter } from '../info';
import { EnvironmentInfoService, IEnvironmentInfo, IEnvironmentInfoService } from '../info/environmentInfoService';
import { resolvePossibleSymlinkToRealPath } from './symlinkResolver';

export interface IEnvironmentsCollection {
    getEnvironments(
        resource?: Resource,
        options?: GetInterpreterLocatorOptions | undefined
    ): Promise<(PartialPythonEnvironment | IEnvironmentInfo)[]>;
}

export const IInterpreterLocatorService = Symbol('IInterpreterLocatorService');
interface IInterpreterLocatorService extends Disposable {
    readonly onLocating: Event<Promise<PythonInterpreter[]>>;
    readonly hasInterpreters: Promise<boolean>;
    onDidChange: Event<Resource>;
    didTriggerInterpreterSuggestions?: boolean;
    getInterpreters(resource?: Uri, options?: GetInterpreterLocatorOptions): Promise<PythonInterpreter[]>;
}

// tslint:disable-next-line:no-require-imports no-var-requires
const flatten = require('lodash/flatten') as typeof import('lodash/flatten');
const partialInfoEnvironmentMapKey = 'PARTIAL_INFO_ENVIRONMENT_MAP_KEY';
const completeInfoEnvironmentMapKey = 'COMPLETE_INFO_ENVIRONMENT_MAP_KEY';

/**
 * Facilitates locating Python interpreters.
 */
export class EnvironmentsCollection implements IEnvironmentsCollection {
    public get onDidChange(): Event<void> {
        return this.didChangeCollectionEmitter.event;
    }
    private readonly partialInfoEnvironmentMap: Map<string, PartialPythonEnvironment>;
    private readonly completeInfoEnvironmentMap: Map<string, PythonInterpreter>;

    private readonly persistentStateFactory: IPersistentStateFactory;
    private readonly platform: IPlatformService;
    private readonly fileSystem: IFileSystem;
    private readonly environmentsInfo: IEnvironmentInfoService;
    private readonly interpreterLocatorHelper: IInterpreterLocatorHelper;
    private readonly mapContainsEnvironments: Deferred<boolean>;
    private readonly didChangeCollectionEmitter = new EventEmitter<void>();

    constructor(private serviceContainer: IServiceContainer) {
        this.environmentsInfo = new EnvironmentInfoService();
        this.platform = serviceContainer.get<IPlatformService>(IPlatformService);
        this.fileSystem = serviceContainer.get<IFileSystem>(IFileSystem);
        this.interpreterLocatorHelper = serviceContainer.get<IInterpreterLocatorHelper>(IInterpreterLocatorHelper);
        this.persistentStateFactory = serviceContainer.get<IPersistentStateFactory>(IPersistentStateFactory);
        this.partialInfoEnvironmentMap = this.persistentStateFactory.createGlobalPersistentState(
            partialInfoEnvironmentMapKey,
            new Map<string, PartialPythonEnvironment>()
        ).value;
        this.completeInfoEnvironmentMap = this.persistentStateFactory.createGlobalPersistentState(
            completeInfoEnvironmentMapKey,
            new Map<string, PythonInterpreter>()
        ).value;
        this.mapContainsEnvironments = createDeferred<boolean>();
        if (this.partialInfoEnvironmentMap.size > 0 || this.completeInfoEnvironmentMap.size > 0) {
            this.mapContainsEnvironments.resolve(true);
        }
        const locators = this.getLocators();
        const disposables = serviceContainer.get<Disposable[]>(IDisposableRegistry);
        locators.forEach((locator) => {
            disposables.push(locator.onDidChange((resource) => this.getEnvironments(resource).ignoreErrors()));
        });
    }

    /**
     * Return the list of known Python interpreters.
     *
     * The optional resource arg may control where locators look for
     * interpreters.
     */
    public async getEnvironments(
        resource?: Uri,
        options?: GetInterpreterLocatorOptions
    ): Promise<(PartialPythonEnvironment | PythonInterpreter)[]> {
        this.removeInvalidEntriesFromEnvironmentMaps();
        const locators = this.getLocators(options);
        const promises = locators.map(async (provider) => provider.getInterpreters(resource));
        promises.forEach(async (promise) => {
            // Add environments received from one locator at a time
            const interpreters = await promise;
            interpreters
                .filter((item) => !isHiddenInterpreter(item))
                .forEach((interpreter) =>
                    this.addPartialInfo(interpreter)
                        .then(() => {
                            // It's crucial to resolve this promise as this method waits on this
                            this.mapContainsEnvironments.resolve(true);
                        })
                        .ignoreErrors()
                );
        });
        const locatorsPromise = Promise.all(promises);
        if (options?.blockOnLocators) {
            await locatorsPromise;
        }
        // Do best effort to return atleast one environment, return an empty list only if no interpreters are found.
        await Promise.race([
            this.mapContainsEnvironments.promise,
            locatorsPromise.then((listOfEnvironments) => {
                const environments = flatten(listOfEnvironments).filter((item) => !isHiddenInterpreter(item));
                if (environments.length === 0) {
                    // No environments discovered, nothing will be added to the map
                    this.mapContainsEnvironments.resolve(false);
                }
                // If locators have discovered atleast one environment, it should be added to the environment map soon so the promise will resolve
                return this.mapContainsEnvironments.promise;
            })
        ]);

        const items = [...this.partialInfoEnvironmentMap.values(), ...this.completeInfoEnvironmentMap.values()];
        return this.interpreterLocatorHelper.mergeInterpreters(items);
    }

    public async addPath(interpreterPath: string) {
        await this.addPartialInfo({ path: interpreterPath });
    }

    private async addPartialInfo(interpreter: PartialPythonEnvironment) {
        interpreter.path = path.normalize(resolvePossibleSymlinkToRealPath(interpreter.path));
        if (this.completeInfoEnvironmentMap.has(interpreter.path)) {
            return;
        }
        const completeInfoPromise = this.environmentsInfo.getEnvironmentInfo(interpreter.path);
        if (this.partialInfoEnvironmentMap.has(interpreter.path)) {
            const storedValue = this.partialInfoEnvironmentMap.get(interpreter.path)!;
            interpreter = (await this.interpreterLocatorHelper.mergeInterpreters([storedValue, interpreter]))[0];
        }
        this.partialInfoEnvironmentMap.set(interpreter.path, interpreter);
        this.didChangeCollectionEmitter.fire();
        completeInfoPromise
            .then((environmentInfo) => {
                if (this.partialInfoEnvironmentMap.has(interpreter.path)) {
                    this.partialInfoEnvironmentMap.delete(interpreter.path);
                }
                if (!environmentInfo) {
                    return;
                }
                // tslint:disable-next-line:no-suspicious-comment
                // TODO: Remove any
                // tslint:disable-next-line:no-any
                this.completeInfoEnvironmentMap.set(interpreter.path, environmentInfo as any);
                this.didChangeCollectionEmitter.fire();
            })
            .ignoreErrors();
    }

    /**
     * Return the list of applicable interpreter locators.
     *
     * The locators are pulled from the registry.
     */
    private getLocators(options?: GetInterpreterLocatorOptions): IInterpreterLocatorService[] {
        // The order of the services is important.
        // The order is important because the data sources at the bottom of the list do not contain all,
        //  the information about the interpreters (e.g. type, environment name, etc).
        // This way, the items returned from the top of the list will win, when we combine the items returned.
        const keys: [string, OSType | undefined][] = [
            [WINDOWS_REGISTRY_SERVICE, OSType.Windows],
            [CONDA_ENV_SERVICE, undefined],
            [CONDA_ENV_FILE_SERVICE, undefined],
            [PIPENV_SERVICE, undefined],
            [GLOBAL_VIRTUAL_ENV_SERVICE, undefined],
            [WORKSPACE_VIRTUAL_ENV_SERVICE, undefined],
            [KNOWN_PATH_SERVICE, undefined],
            [CURRENT_PATH_SERVICE, undefined]
        ];

        const locators = keys
            .filter((item) => item[1] === undefined || item[1] === this.platform.osType)
            .map((item) => this.serviceContainer.get<IInterpreterLocatorService>(IInterpreterLocatorService, item[0]));

        // Set it to true the first time the user selects an interpreter
        if (options?.onSuggestion === true) {
            locators.forEach((locator) => (locator.didTriggerInterpreterSuggestions = true));
        }

        return locators;
    }

    private removeInvalidEntriesFromEnvironmentMaps() {
        [...this.partialInfoEnvironmentMap.keys()].map((key) => {
            const doesEnvironmentExist = this.fileSystem.fileExistsSync(key);
            if (!doesEnvironmentExist) {
                this.partialInfoEnvironmentMap.delete(key);
            }
        });
        [...this.completeInfoEnvironmentMap.keys()].map((key) => {
            const doesEnvironmentExist = this.fileSystem.fileExistsSync(key);
            if (!doesEnvironmentExist) {
                this.completeInfoEnvironmentMap.delete(key);
            }
        });
    }
}
