package io.bdeploy.minion.api.v1;

import java.util.ArrayList;
import java.util.List;

import javax.ws.rs.container.ResourceContext;
import javax.ws.rs.core.Context;
import javax.ws.rs.core.UriInfo;

import io.bdeploy.api.remote.v1.PublicInstanceResource;
import io.bdeploy.api.remote.v1.PublicRootResource;
import io.bdeploy.api.remote.v1.dto.InstanceGroupConfigurationApi;
import io.bdeploy.api.remote.v1.dto.SoftwareRepositoryConfigurationApi;
import io.bdeploy.interfaces.configuration.instance.InstanceGroupConfiguration;
import io.bdeploy.interfaces.configuration.instance.SoftwareRepositoryConfiguration;
import io.bdeploy.minion.remote.jersey.CommonRootResourceImpl;

/**
 * V1 implementation of the public API.
 */
public class PublicRootResourceImpl implements PublicRootResource {

    @Context
    private ResourceContext rc;

    @Context
    private UriInfo ui;

    @Override
    public String getVersion() {
        return rc.getResource(CommonRootResourceImpl.class).getVersion().toString();
    }

    @Override
    public List<SoftwareRepositoryConfigurationApi> getSoftwareRepositories() {
        List<SoftwareRepositoryConfigurationApi> result = new ArrayList<>();
        for (SoftwareRepositoryConfiguration src : rc.getResource(CommonRootResourceImpl.class).getSoftwareRepositories()) {
            SoftwareRepositoryConfigurationApi srca = new SoftwareRepositoryConfigurationApi();

            srca.name = src.name;
            srca.description = src.description;

            result.add(srca);
        }
        return result;
    }

    @Override
    public List<InstanceGroupConfigurationApi> getInstanceGroups() {
        List<InstanceGroupConfigurationApi> result = new ArrayList<>();

        for (InstanceGroupConfiguration igc : rc.getResource(CommonRootResourceImpl.class).getInstanceGroups()) {
            InstanceGroupConfigurationApi igca = new InstanceGroupConfigurationApi();

            igca.name = igc.name;
            igca.title = igc.title;
            igca.description = igc.description;

            result.add(igca);
        }

        return result;
    }

    @Override
    public PublicInstanceResource getInstanceResource(String group) {
        return rc.initResource(new PublicInstanceResourceImpl(group));
    }

}