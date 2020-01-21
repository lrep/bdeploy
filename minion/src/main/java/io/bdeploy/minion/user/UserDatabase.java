package io.bdeploy.minion.user;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.SortedSet;
import java.util.TreeSet;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.google.common.cache.Cache;
import com.google.common.cache.CacheBuilder;

import io.bdeploy.bhive.BHive;
import io.bdeploy.bhive.model.Manifest;
import io.bdeploy.bhive.model.Manifest.Key;
import io.bdeploy.bhive.model.Tree;
import io.bdeploy.bhive.objects.view.ElementView;
import io.bdeploy.bhive.op.ImportObjectOperation;
import io.bdeploy.bhive.op.InsertArtificialTreeOperation;
import io.bdeploy.bhive.op.InsertManifestOperation;
import io.bdeploy.bhive.op.ManifestDeleteOldByIdOperation;
import io.bdeploy.bhive.op.ManifestDeleteOperation;
import io.bdeploy.bhive.op.ManifestListOperation;
import io.bdeploy.bhive.op.ManifestLoadOperation;
import io.bdeploy.bhive.op.ManifestMaxIdOperation;
import io.bdeploy.bhive.op.ManifestNextIdOperation;
import io.bdeploy.bhive.op.ObjectConsistencyCheckOperation;
import io.bdeploy.bhive.op.TreeEntryLoadOperation;
import io.bdeploy.bhive.util.StorageHelper;
import io.bdeploy.common.security.ScopedCapability;
import io.bdeploy.interfaces.UserInfo;
import io.bdeploy.interfaces.configuration.instance.InstanceGroupPermissionDto;
import io.bdeploy.interfaces.manifest.SettingsManifest;
import io.bdeploy.interfaces.settings.AuthenticationSettingsDto;
import io.bdeploy.minion.MinionRoot;
import io.bdeploy.minion.user.ldap.LdapAuthenticator;
import io.bdeploy.ui.api.AuthService;

/**
 * Persistence for users which are allowed to authenticate against this minion.
 * <p>
 * Intentionally kept simple (and potentially slow) for now.
 */
public class UserDatabase implements AuthService {

    private static final Logger log = LoggerFactory.getLogger(UserDatabase.class);
    private static final String NAMESPACE = "users/";
    private static final String FILE_NAME = "user.json";

    private final Cache<String, UserInfo> userCache = CacheBuilder.newBuilder().expireAfterWrite(10, TimeUnit.MINUTES)
            .maximumSize(1_000).build();

    private final MinionRoot root;
    private final BHive target;

    private final List<Authenticator> authenticators = new ArrayList<>();

    public UserDatabase(MinionRoot root) {
        this.root = root;
        this.target = root.getHive();

        this.authenticators.add(new PasswordAuthentication());
        this.authenticators.add(new LdapAuthenticator());
    }

    @Override
    public void updateUserInfo(UserInfo info) {
        UserInfo old = getUser(info.name);

        if (old.external != info.external) {
            throw new UnsupportedOperationException("Update on external user not supported");
        }

        if (old.external) {
            // managed by external system.
            info.fullName = old.fullName;
            info.email = old.email;
        }

        info.password = old.password; // don't update this.

        internalUpdate(info.name, info);
    }

    @Override
    public synchronized void updateInstanceGroupPermissions(String group, InstanceGroupPermissionDto[] permissions) {
        for (InstanceGroupPermissionDto dto : permissions) {
            UserInfo info = getUser(dto.user);
            if (info == null) {
                throw new IllegalStateException("Cannot find user " + dto.user);
            }

            // clear all scoped capabilities for 'group'
            info.capabilities.removeIf(c -> group.equals(c.scope));

            // add given scoped capability
            if (dto.capability != null) {
                info.capabilities.add(new ScopedCapability(group, dto.capability));
            }

            internalUpdate(info.name, info);
        }
    }

    @Override
    public void createLocalUser(String user, String pw, Collection<ScopedCapability> capabilities) {
        UserInfo info = new UserInfo(user);

        info.password = PasswordAuthentication.hash(pw.toCharArray());
        if (capabilities != null) {
            info.capabilities.addAll(capabilities);
        }

        internalUpdate(user, info);
    }

    /**
     * Update the password of a local user.
     *
     * @param user the user name
     * @param pw the password to set or <code>null</code> to keep the current password
     */
    @Override
    public void updateLocalPassword(String user, String pw) {
        UserInfo info = getUser(user);
        if (info == null) {
            throw new IllegalStateException("Cannot find user " + user);
        }

        if (pw != null) {
            if (info.external) {
                throw new IllegalStateException("Cannot set password of externally-managed user");
            }
            info.password = PasswordAuthentication.hash(pw.toCharArray());
        }

        internalUpdate(user, info);
    }

    @Override
    public List<String> getRecentlyUsedInstanceGroups(String user) {
        UserInfo info = getUser(user);
        if (info == null) {
            return Collections.emptyList();
        }

        return info.recentlyUsedInstanceGroups;
    }

    @Override
    public void addRecentlyUsedInstanceGroup(String user, String group) {
        UserInfo info = getUser(user);
        if (info == null) {
            return;
        }
        List<String> recentlyUsed = info.recentlyUsedInstanceGroups;

        // Check if the current group is already the latest one
        int index = recentlyUsed.indexOf(group);
        if (index != -1 && index == recentlyUsed.size() - 1) {
            return;
        }

        // force group to be last in the list.
        recentlyUsed.remove(group);
        while (recentlyUsed.size() >= 10) {
            recentlyUsed.remove(0);
        }

        recentlyUsed.add(group);

        // rebuild the list, evict duplicates (even though they SHOULD not exist, they do).
        info.recentlyUsedInstanceGroups = recentlyUsed.stream().distinct().collect(Collectors.toList());
        updateUserInfo(info);
    }

    private synchronized void internalUpdate(String user, UserInfo info) {
        Long id = target.execute(new ManifestNextIdOperation().setManifestName(NAMESPACE + user));
        Manifest.Key key = new Manifest.Key(NAMESPACE + user, String.valueOf(id));

        Tree.Builder root = new Tree.Builder();
        root.add(new Tree.Key(FILE_NAME, Tree.EntryType.BLOB),
                target.execute(new ImportObjectOperation().setData(StorageHelper.toRawBytes(info))));

        target.execute(new InsertManifestOperation().addManifest(new Manifest.Builder(key)
                .setRoot(target.execute(new InsertArtificialTreeOperation().setTree(root))).build(null)));

        target.execute(new ManifestDeleteOldByIdOperation().setAmountToKeep(10).setToDelete(NAMESPACE + user));

        // update the cache.
        userCache.put(user, info);
    }

    @Override
    public void deleteUser(String user) {
        SortedSet<Key> mfs = target.execute(new ManifestListOperation().setManifestName(NAMESPACE + user));
        log.info("Deleting {} manifests for user {}", mfs.size(), user);
        mfs.forEach(k -> target.execute(new ManifestDeleteOperation().setToDelete(k)));
        userCache.invalidate(user);
    }

    @Override
    public SortedSet<String> getAllNames() {
        SortedSet<Key> keys = target.execute(new ManifestListOperation().setManifestName(NAMESPACE));
        return keys.stream().map(k -> k.getName().substring(NAMESPACE.length())).collect(Collectors.toCollection(TreeSet::new));
    }

    @Override
    public SortedSet<UserInfo> getAll() {
        return getAllNames().stream().map(name -> getUser(name)).collect(Collectors.toCollection(TreeSet::new));
    }

    @Override
    public UserInfo authenticate(String user, String pw) {
        AuthenticationSettingsDto settings = SettingsManifest.read(target, root.getEncryptionKey(), false).auth;

        UserInfo u = getUser(user);
        if (u == null) {
            for (Authenticator auth : authenticators) {
                u = auth.getInitialInfo(user, pw.toCharArray(), settings);
                if (u != null) {
                    u.lastActiveLogin = System.currentTimeMillis();
                    internalUpdate(user, u);
                    return u; // already successfully authenticated using the given password.
                }
            }
            return null;
        }

        for (Authenticator auth : authenticators) {
            if (auth.isResponsible(u, settings)) {
                UserInfo authenticated = auth.authenticate(u, pw.toCharArray(), settings);
                if (authenticated != null) {
                    authenticated.lastActiveLogin = System.currentTimeMillis();
                    internalUpdate(user, authenticated);
                    return authenticated;
                }
            }
        }

        return null;
    }

    @Override
    public UserInfo getUser(String name) {
        // Note: We are using getIfPresent and put instead of get(name, Callable) as we need to handle null values
        UserInfo info = userCache.getIfPresent(name);
        if (info != null) {
            return info;
        }
        Optional<Long> current = target.execute(new ManifestMaxIdOperation().setManifestName(NAMESPACE + name));
        if (!current.isPresent()) {
            return null;
        }

        Manifest.Key key = new Manifest.Key(NAMESPACE + name, String.valueOf(current.get()));
        Manifest mf = target.execute(new ManifestLoadOperation().setManifest(key));

        // check the manifest for manipulation to prevent from manually making somebody admin, etc.
        Set<ElementView> result = target.execute(new ObjectConsistencyCheckOperation().addRoot(key));
        if (!result.isEmpty()) {
            log.error("User corruption detected for {}", name);
            return null;
        }
        try (InputStream is = target.execute(new TreeEntryLoadOperation().setRelativePath(FILE_NAME).setRootTree(mf.getRoot()))) {
            info = StorageHelper.fromStream(is, UserInfo.class);
            userCache.put(name, info);
            return info;
        } catch (Exception ex) {
            log.error("Failed to persist user: {}", name, ex);
            return null;
        }
    }

    @Override
    public boolean isAuthorized(String user, ScopedCapability required) {
        UserInfo info = getUser(user);
        if (info == null) {
            return false;
        }
        for (ScopedCapability capability : info.capabilities) {
            if (capability.satisfies(required)) {
                return true;
            }
        }
        return false;
    }

}
