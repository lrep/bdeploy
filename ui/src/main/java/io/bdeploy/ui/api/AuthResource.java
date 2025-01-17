package io.bdeploy.ui.api;

import io.bdeploy.api.remote.v1.dto.CredentialsApi;
import io.bdeploy.common.security.RequiredPermission;
import io.bdeploy.common.security.ScopedPermission.Permission;
import io.bdeploy.interfaces.UserChangePasswordDto;
import io.bdeploy.interfaces.UserInfo;
import io.bdeploy.interfaces.settings.SpecialAuthenticators;
import io.bdeploy.jersey.JerseyAuthenticationProvider.Unsecured;
import io.bdeploy.jersey.SessionManager;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.CookieParam;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.Cookie;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

@Path("/auth")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public interface AuthResource {

    /**
     * @param credentials the credentials to check
     * @return a signed token if authentication succeeded
     */
    @POST
    @Unsecured
    public Response authenticate(CredentialsApi credentials);

    /**
     * Same as {@link #authenticate(CredentialsApi)} but returns a authentication pack suitable for CLI and
     * other tools.
     */
    @POST
    @Path("/packed")
    @Unsecured
    public Response authenticatePacked(CredentialsApi credentials);

    /**
     * Authenticates a user and begins a local web-session for that user.
     *
     * @param credentials the credentials to check
     * @param auth a special authenticator to use or <code>null</code>.
     * @return a signed token if authentication succeeded
     */
    @POST
    @Path("/session")
    @Unsecured
    public Response authenticateSession(CredentialsApi credentials, @QueryParam("auth") SpecialAuthenticators auth);

    /**
     * @return the current session full token for the issued request.
     */
    @GET
    @Path("/session")
    public String getSessionToken(@CookieParam(SessionManager.SESSION_COOKIE) Cookie session);

    /**
     * Terminates the current session and logs the use off.
     */
    @POST
    @Path("/session/logout")
    public Response logout(@CookieParam(SessionManager.SESSION_COOKIE) Cookie session);

    /**
     * Retrieve the current user.
     * <p>
     * The password field is cleared out.
     *
     * @return the currently logged in user's information.
     */
    @GET
    @Path("/user")
    public UserInfo getCurrentUser();

    /**
     * Updates the current user with the given information.
     *
     * @param info the info for the current user.
     */
    @POST
    @Path("/user")
    public void updateCurrentUser(UserInfo info);

    /**
     * Updates the current user's password.
     *
     * @param dto password data
     */
    @POST
    @Path("/change-password")
    public Response changePassword(UserChangePasswordDto dto);

    /**
     * @return an authentication pack which can be used for build integrations and command line token authentication.
     */
    @GET
    @Path("/auth-pack")
    @Produces(MediaType.TEXT_PLAIN)
    public String getAuthPack(@QueryParam("user") String user, @QueryParam("full") Boolean full);

    /**
     * @return the administrative interface for user managements.
     */
    @Path("/admin")
    @RequiredPermission(permission = Permission.ADMIN)
    public AuthAdminResource getAdmin();
}
