package io.bdeploy.api.remote.v1;

import java.util.List;

import javax.ws.rs.Consumes;
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.Produces;
import javax.ws.rs.QueryParam;
import javax.ws.rs.core.MediaType;

import io.bdeploy.api.remote.v1.dto.InstanceGroupConfigurationApi;
import io.bdeploy.api.remote.v1.dto.SoftwareRepositoryConfigurationApi;
import io.bdeploy.jersey.ActivityScope;
import io.bdeploy.jersey.JerseyAuthenticationProvider.WeakTokenAllowed;
import io.swagger.v3.oas.annotations.OpenAPIDefinition;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.info.Info;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;

@OpenAPIDefinition(info = @Info(title = "BDeploy Public Master API", description = "BDeploy backend APIs for public use. "
        + "Callers must set the X-BDeploy-Authorization header to be able to access APIs. "
        + "This token can be obtained through the CLI and the Web UI. "
        + "The API is exposed on any BDeploy master (regardless of its mode) on the '/api' namespace (e.g. 'https://localhost:7701/api/public/v1/...')"),
                   security = { @SecurityRequirement(name = "X-BDeploy-Authorization") })
@Path("/public/v1")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public interface PublicRootResource {

    @GET
    @WeakTokenAllowed
    @Path("/version")
    public String getVersion();

    /**
     * Software repository hives contain additional software which can be referenced when building products.
     *
     * @return the list of available software repository hives on the master.
     */
    @Operation(summary = "Get Software Repositories",
               description = "Retrieve a list of all available Software Repositories which may be used to resolve product dependencies at build time.")
    @GET
    @Path("/softwareRepositories")
    public List<SoftwareRepositoryConfigurationApi> getSoftwareRepositories();

    /**
     * Software repository hives contain additional software which can be referenced when building products.
     *
     * @return the list of available software repository hives on the master.
     */
    @Operation(summary = "Get Instance Groups", description = "Retrieve a list of all available Instance Groups on the server.")
    @GET
    @Path("/instanceGroups")
    public List<InstanceGroupConfigurationApi> getInstanceGroups();

    /**
     * Returns a resource which can be used to query or access an instance.
     * <p>
     * Common resource also available on the central master.
     * <p>
     * Note: query parameter name <b>must</b> start with 'BDeploy_'
     *
     * @param group the instance group ID to get the instance resource for.
     * @return the {@link PublicInstanceResource} to query information from.
     */
    @Operation
    @Path("/common")
    public PublicInstanceResource getInstanceResource(
            @Parameter(description = "The name of the instance group to access") @ActivityScope @QueryParam("BDeploy_group") String group);

}