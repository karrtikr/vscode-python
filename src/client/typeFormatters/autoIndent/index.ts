// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IWorkspaceService } from '../../common/application/types';

@injectable()
export class AutoIndent implements IExtensionSingleActivationService {
    constructor(@inject(IWorkspaceService) private workspaceService: IWorkspaceService) {}

    public async activate(): Promise<void> {
        const settings = this.workspaceService.getConfiguration('editor', { languageId: 'python' });
        await settings.update('formatOnType', true, true, true);
    }
}
