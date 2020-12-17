package io.bdeploy.interfaces.remote;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;

import io.bdeploy.interfaces.configuration.pcu.InstanceNodeStatusDto;
import io.bdeploy.interfaces.configuration.pcu.ProcessDetailDto;
import io.bdeploy.interfaces.directory.RemoteDirectoryEntry;
import io.bdeploy.interfaces.manifest.history.runtime.MinionRuntimeHistoryDto;

@Path("/processes")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public interface NodeProcessResource {

    /**
     * Starts all applications of an instance having the start type 'INSTANCE' configured
     *
     * @param instanceId
     *            the unique id of the instance.
     */
    @POST
    @Path("/startAll")
    public void start(@QueryParam("u") String instanceId);

    /**
     * Starts a single application of an instance.
     *
     * @param instanceId
     *            the unique id of the instance.
     * @param applicationId
     *            the unique ID of the application.
     */
    @POST
    @Path("/startApp")
    public void start(@QueryParam("u") String instanceId, @QueryParam("a") String applicationId);

    /**
     * Stops a single application of an instance.
     *
     * @param instanceId
     *            the unique id of the instance.
     * @param applicationId
     *            the unique ID of the application.
     */
    @POST
    @Path("/stopApp")
    public void stop(@QueryParam("u") String instanceId, @QueryParam("a") String applicationId);

    /**
     * Stops all applications of an instance.
     *
     * @param instanceId
     *            the unique id of the instance.
     */
    @POST
    @Path("/stopAll")
    public void stop(@QueryParam("u") String instanceId);

    /**
     * Returns status information about an instance.
     *
     * @param instanceId
     *            the unique id of the instance.
     * @return the status information
     */
    @GET
    @Path("/process-status")
    public InstanceNodeStatusDto getStatus(@QueryParam("u") String instanceId);

    /**
     * Returns the full status of a single application.
     *
     * @param instanceId the unique id of the instance.
     * @param appUid the application UID to query
     * @return the full detailed status of the process.
     */
    @GET
    @Path("/process-details")
    public ProcessDetailDto getProcessDetails(@QueryParam("u") String instanceId, @QueryParam("a") String appUid);

    /**
     * @param instanceId the instance UUID
     * @param tag the tag for which to retrieve the output file entry.
     * @param applicationId the application ID for which to retrieve the output file entry.
     * @return an {@link RemoteDirectoryEntry}, can be used with
     *         {@link NodeDeploymentResource#getEntryContent(RemoteDirectoryEntry, long, long)}.
     */
    @GET
    @Path("/output")
    public RemoteDirectoryEntry getOutputEntry(@QueryParam("u") String instanceId, @QueryParam("t") String tag,
            @QueryParam("a") String applicationId);

    /**
     * Writes data to the stdin stream of an application.
     *
     * @param instanceId
     *            the unique id of the instance.
     * @param applicationId
     *            the unique ID of the application.
     * @param data
     *            the data to write to stdin of the application.
     */
    @POST
    @Path("/stdin")
    public void writeToStdin(@QueryParam("u") String instanceId, @QueryParam("a") String applicationId, String data);

    /**
     * Returns the runtime events of the given instance. The returned map is indexed by the instance tag.
     */
    @GET
    @Path("/runtimeHistory")
    public MinionRuntimeHistoryDto getRuntimeHistory(@QueryParam("u") String instanceId);

}
