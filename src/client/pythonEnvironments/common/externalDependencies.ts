import { IFileSystem } from '../../common/platform/types';
import { ExecutionResult, IProcessServiceFactory } from '../../common/process/types';
import { IServiceContainer } from '../../ioc/types';

let internalServiceContainer: IServiceContainer;
export function initializeExternalDependencies(serviceContainer: IServiceContainer): void {
    internalServiceContainer = serviceContainer;
}

function getProcessFactory(): IProcessServiceFactory {
    return internalServiceContainer.get<IProcessServiceFactory>(IProcessServiceFactory);
}

export async function shellExecute(command: string, timeout: number): Promise<ExecutionResult<string>> {
    const proc = await getProcessFactory().create();
    return proc.shellExec(command, { timeout });
}

function getFileSystem() {
    return internalServiceContainer.get<IFileSystem>(IFileSystem);
}

export async function fileExists(path: string): Promise<boolean> {
    return getFileSystem().fileExists(path);
}
