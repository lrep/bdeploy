import { cloneDeep } from 'lodash';
import { getAppKeyName } from '../utils/manifest.utils';
import { ApplicationGroup } from './application.model';
import { CLIENT_NODE_NAME, EMPTY_INSTANCE_NODE_CONFIGURATION, EMPTY_INSTANCE_NODE_CONFIGURATION_DTO } from './consts';
import { ApplicationConfiguration, ApplicationDto, ApplicationType, InstanceConfiguration, InstanceNodeConfigurationDto, InstanceNodeConfigurationListDto, InstanceVersionDto } from './gen.dtos';

/**
 * Context information for EventEmitter
 */
export class EditAppConfigContext {
  constructor(
    public instanceNodeConfigurationDto: InstanceNodeConfigurationDto,
    public applicationConfiguration: ApplicationConfiguration,
  ) {}
}

/**
 * Mapping of a specific version to a specific instance and node configuration.
 */
export class ProcessConfigDto {
  /** Whether or not the configuration can be modified */
  public readonly: boolean;

  /** Whether or not there are local unsaved changes */
  public dirty = false;

  /** Whether or not there are validation issues */
  public valid = true;

  /** Current version */
  public version: InstanceVersionDto;

  /** Original version */
  public clonedVersion: InstanceVersionDto;

  /** Current state of the configuration */
  public nodeList: InstanceNodeConfigurationListDto;

  /** Original state of the configuration */
  public clonedNodeList: InstanceNodeConfigurationListDto;

  /** The instance configuration */
  public instance: InstanceConfiguration;

  /** Original state of the instance */
  public clonedInstance: InstanceConfiguration;

  /** Client applications grouped according to their type */
  public clientApps: ApplicationGroup[] = [];

  /** Server applications grouped according to their type */
  public serverApps: ApplicationGroup[] = [];

  constructor(version: InstanceVersionDto, readonly: boolean) {
    this.version = cloneDeep(version);
    this.clonedVersion = cloneDeep(version);
    this.readonly = readonly;
  }

  /**
   * Discards all local changes.
   */
  public discardChanges() {
    this.dirty = false;
    this.valid = true;
    this.version = cloneDeep(this.clonedVersion);
    this.instance = cloneDeep(this.clonedInstance);
    this.nodeList = cloneDeep(this.clonedNodeList);
  }

  /**
   * Sets the instance of this process.
   */
  public setInstance(instance: InstanceConfiguration) {
    this.instance = instance;
    this.clonedInstance = cloneDeep(instance);
  }

  /**
   * Sets the applications belonging to this configuration
   */
  public setApplications(apps: ApplicationDto[]) {
    this.serverApps = this.groupApplications(apps, ApplicationType.SERVER);
    this.clientApps = this.groupApplications(apps, ApplicationType.CLIENT);
  }

  /**
   * Sets the node configurations of this configuration.
   */
  public setNodeList(nodeList: InstanceNodeConfigurationListDto) {
    this.nodeList = nodeList;
    this.initClientApplicationNode();
    this.nodeList.nodeConfigDtos = this.sortNodeConfigs(nodeList.nodeConfigDtos);
    this.clonedNodeList = cloneDeep(nodeList);
  }

  /**
   * Returns a sorted list of node configurations.
   * Master is always the first entry. Client node is always the last one
   */
  sortNodeConfigs(configs: InstanceNodeConfigurationDto[]): InstanceNodeConfigurationDto[] {
    configs.sort((a, b) => {
      if (a.nodeName === CLIENT_NODE_NAME) {
        return 1;
      } else if (b.nodeName === CLIENT_NODE_NAME) {
        return -1;
      }
      if (!a.status || !b.status || a.status.master === b.status.master) {
        return a.nodeName.toLocaleLowerCase().localeCompare(b.nodeName.toLocaleLowerCase());
      }
      return a.status.master ? -1 : 1;
    });
    return configs;
  }

  groupApplications(apps: ApplicationDto[], type: ApplicationType): ApplicationGroup[] {
    const groups = new Map<String, ApplicationGroup>();
    for (const app of apps) {
      if (app.descriptor.type !== type) {
        continue;
      }
      const name = getAppKeyName(app.key);
      let group = groups.get(name);
      if (group == null) {
        group = new ApplicationGroup();
        groups.set(name, group);
      }
      group.add(app);
    }
    // Sort applications by their name
    const values = Array.from(groups.values());
    values.sort((a, b) => {
      return a.appName.localeCompare(b.appName);
    });
    return values;
  }

  hasClientApplications(): boolean {
    return this.clientApps.length > 0;
  }

  hasServerApplications(): boolean {
    return this.serverApps.length > 0;
  }

  initClientApplicationNode(): void {
    let clientApplicationsNode = this.nodeList.nodeConfigDtos.find(dto => dto.nodeName === CLIENT_NODE_NAME);
    if (!clientApplicationsNode) {
      clientApplicationsNode = cloneDeep(EMPTY_INSTANCE_NODE_CONFIGURATION_DTO);
      clientApplicationsNode.nodeName = CLIENT_NODE_NAME;
      clientApplicationsNode.nodeConfiguration = cloneDeep(EMPTY_INSTANCE_NODE_CONFIGURATION);
      clientApplicationsNode.nodeConfiguration.uuid = this.instance.uuid;
      clientApplicationsNode.nodeConfiguration.name = CLIENT_NODE_NAME;
      this.nodeList.nodeConfigDtos.push(clientApplicationsNode);
    }
  }
}
