package io.bdeploy.ui.cli;

import java.time.Instant;

import io.bdeploy.common.cfg.Configuration.Help;
import io.bdeploy.common.cli.ToolBase.CliTool.CliName;
import io.bdeploy.common.cli.ToolCategory;
import io.bdeploy.common.cli.data.DataTable;
import io.bdeploy.common.cli.data.RenderableResult;
import io.bdeploy.common.security.ApiAccessToken;
import io.bdeploy.common.security.RemoteService;
import io.bdeploy.common.security.ScopedPermission;
import io.bdeploy.common.security.ScopedPermission.Permission;
import io.bdeploy.common.util.FormatHelper;
import io.bdeploy.interfaces.UserInfo;
import io.bdeploy.interfaces.remote.ResourceProvider;
import io.bdeploy.jersey.cli.RemoteServiceTool;
import io.bdeploy.ui.api.AuthAdminResource;
import io.bdeploy.ui.api.AuthResource;
import io.bdeploy.ui.cli.RemoteUserTool.UserConfig;

/**
 * Manages users.
 */
@Help("Manage (configuration UI) users on a master.")
@ToolCategory(TextUIResources.UI_CATEGORY)
@CliName("remote-user")
public class RemoteUserTool extends RemoteServiceTool<UserConfig> {

    public @interface UserConfig {

        @Help("Adds a user with the given name.")
        String add();

        @Help("Updates a user with the given name")
        String update();

        @Help("The password for the user to add.")
        String password();

        @Help("Add global admin permission to the user. Shortcut for --permission=ADMIN")
        boolean admin() default false;

        @Help("Add a specific permission to the user. Values can be READ, WRITE or ADMIN. Use in conjunction with --scope to, otherwise permission is global.")
        String permission();

        @Help("Scopes a specific permission specified with --permission to a certain instance group")
        String scope();

        @Help(value = "Mark user as active during add/update", arg = false)
        boolean active() default false;

        @Help(value = "Mark user as inactive during add/update", arg = false)
        boolean inactive() default false;

        @Help("The name of the user to remove.")
        String remove();

        @Help(value = "When given, list all known users.", arg = false)
        boolean list() default false;

        @Help("Creates a token with the privileges of the given user.")
        String createToken();
    }

    public RemoteUserTool() {
        super(UserConfig.class);
    }

    @Override
    protected RenderableResult run(UserConfig config, RemoteService remote) {
        AuthResource auth = ResourceProvider.getResource(remote, AuthResource.class, getLocalContext());
        AuthAdminResource admin = auth.getAdmin();

        if (config.add() != null) {
            addUser(config, admin);
        } else if (config.update() != null) {
            updateUser(config, admin);
        } else if (config.remove() != null) {
            admin.deleteUser(config.remove());
        } else if (config.list()) {
            DataTable table = createDataTable();
            table.setCaption("User accounts on " + remote.getUri());

            table.column("Username", 30).column("System", 10).column("Inact.", 6).column("E-Mail", 30)
                    .column("Last Active Login", 20).column("Permissions", 60);

            for (UserInfo info : admin.getAllUser()) {
                table.row().cell(info.name).cell(info.externalSystem).cell(info.inactive ? "*" : "").cell(info.email)
                        .cell(FormatHelper.format(Instant.ofEpochMilli(info.lastActiveLogin))).cell(info.permissions.toString())
                        .build();
            }
            return table;
        } else if (config.createToken() != null) {
            createToken(config, auth);
            return null; // special output
        } else {
            return createNoOp();
        }
        return createSuccess();
    }

    private void createToken(UserConfig config, AuthResource auth) {
        String token = auth.getAuthPack(config.createToken(), true);

        out().println("Generating token with 50 years validity for " + config.createToken());
        out().println("Use the following token to remotely access this server in your name");
        out().println("Attention: This token is sensitive information as it allows remote access under your name. "
                + "Do not pass this token on to others.");
        out().println("");
        out().println(token);
        out().println("");
    }

    private void updateUser(UserConfig config, AuthAdminResource admin) {
        UserInfo user = admin.getUser(config.update());
        if (user == null) {
            out().println("Cannot find user " + config.update());
            return;
        }
        if (config.password() != null) {
            admin.updateLocalUserPassword(config.update(), config.password());
        }
        boolean updated = false;
        if (config.active() || config.inactive()) {
            setInactive(user, config);
            updated = true;
        }
        if (config.admin()) {
            user.permissions.add(ApiAccessToken.ADMIN_PERMISSION);
            updated = true;
        }
        if (config.permission() != null) {
            user.permissions.add(new ScopedPermission(config.scope(), Permission.valueOf(config.permission().toUpperCase())));
            updated = true;
        }
        if (updated) {
            admin.updateUser(user);
        }
    }

    private void addUser(UserConfig config, AuthAdminResource admin) {
        UserInfo user = new UserInfo(config.add());

        setInactive(user, config);
        if (config.admin()) {
            user.permissions.add(ApiAccessToken.ADMIN_PERMISSION);
        }
        if (config.permission() != null) {
            user.permissions.add(new ScopedPermission(config.scope(), Permission.valueOf(config.permission().toUpperCase())));
        }
        user.password = config.password();
        admin.createLocalUser(user);
    }

    private void setInactive(UserInfo user, UserConfig config) {
        if (config.active() && config.inactive()) {
            helpAndFail("Cannot mark user as both active and inactive");
        }
        if (config.active()) {
            user.inactive = false;
        }
        if (config.inactive()) {
            user.inactive = true;
        }
    }

}
