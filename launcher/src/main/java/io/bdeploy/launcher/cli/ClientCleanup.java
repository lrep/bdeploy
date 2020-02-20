package io.bdeploy.launcher.cli;

import java.nio.file.Path;
import java.util.Set;
import java.util.SortedMap;
import java.util.SortedSet;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.bdeploy.bhive.BHive;
import io.bdeploy.bhive.model.Manifest;
import io.bdeploy.bhive.model.Manifest.Key;
import io.bdeploy.bhive.model.ObjectId;
import io.bdeploy.bhive.op.ManifestDeleteOperation;
import io.bdeploy.bhive.op.ManifestListOperation;
import io.bdeploy.bhive.op.PruneOperation;
import io.bdeploy.common.Version;
import io.bdeploy.common.util.PathHelper;
import io.bdeploy.common.util.UnitHelper;
import io.bdeploy.common.util.VersionHelper;
import io.bdeploy.interfaces.UpdateHelper;

/**
 * Cleans software from the hive which is not used any more. The {@linkplain ClientSoftwareManifest} is used in
 * order to determine which software is used and which one not. Applications listed in the hive which are not referenced by any
 * manifest are removed from the hive and from the pool. Only the latest version of the manifest is taken into account.
 */
public class ClientCleanup {

    private static final Logger log = LoggerFactory.getLogger(ClientCleanup.class);

    private final BHive hive;
    private final Path appsDir;
    private final Path poolDir;

    /**
     * Creates a new cleanup instance using the given hive
     */
    public ClientCleanup(BHive hive, Path appsDir, Path poolDir) {
        this.hive = hive;
        this.appsDir = appsDir;
        this.poolDir = poolDir;
    }

    /**
     * Removes software that is not used anymore.
     */
    public void run() {
        doCleanApps();
        doCleanLaunchers();
        doCleanup();
    }

    /** Removes all launchers that are not required any more */
    private void doCleanLaunchers() {
        // Collect all required launchers
        ClientSoftwareManifest mf = new ClientSoftwareManifest(hive);
        Set<Key> required = mf.getRequiredLauncherKeys();

        // Collect all available software in the hive
        Set<Key> available = getAvailableLaunchers();
        if (available.isEmpty()) {
            log.info("No launchers are installed.");
            return;
        }

        // Remove all the software that is still required
        available.removeAll(required);
        if (available.isEmpty()) {
            log.info("All launchers are still in-use.");
            return;
        }

        // Cleanup hive and launcher
        log.info("Removing stale launchers that are not used any more...");
        for (Manifest.Key key : available) {
            log.info("Deleting {}", key);

            hive.execute(new ManifestDeleteOperation().setToDelete(key));

            Version version = VersionHelper.parse(key.getTag());
            Path launcherPath = ClientPathHelper.getHome(version);
            if (launcherPath.toFile().exists()) {
                PathHelper.deleteRecursive(launcherPath);
                log.info("Deleting {}", launcherPath);
            }
        }
    }

    /** Removes old application versions not required anymore */
    private void doCleanApps() {
        // Collect all required software
        ClientSoftwareManifest mf = new ClientSoftwareManifest(hive);
        Set<Key> requiredApps = mf.getRequiredKeys();

        // Collect all available software in the hive
        Set<Key> availableApps = getAvailableApps();
        if (availableApps.isEmpty()) {
            log.info("No applications are installed.");
            return;
        }

        // Remove all the software that is still required
        availableApps.removeAll(requiredApps);
        if (availableApps.isEmpty()) {
            log.info("All pooled applications are still in-use.");
            return;
        }

        // Cleanup hive and pool
        log.info("Removing stale pooled applications that are not used any more...");
        for (Manifest.Key key : availableApps) {
            log.info("Deleting {}", key);

            hive.execute(new ManifestDeleteOperation().setToDelete(key));

            Path pooledPath = poolDir.resolve(key.directoryFriendlyName());
            if (pooledPath.toFile().exists()) {
                PathHelper.deleteRecursive(pooledPath);
            }
        }
    }

    /** Cleans the hive as well as the pool and apps directory */
    private void doCleanup() {
        // Remove pool and apps directory if they are empty
        if (poolDir.toFile().exists() && PathHelper.isDirEmpty(poolDir)) {
            PathHelper.deleteRecursive(poolDir);
            log.info("Removed empty pool folder {}", poolDir);
        }
        if (appsDir.toFile().exists() && PathHelper.isDirEmpty(appsDir)) {
            PathHelper.deleteRecursive(appsDir);
            log.info("Removed apps folder {}", appsDir);
        }

        // Delete unreferenced elements
        SortedMap<ObjectId, Long> result = hive.execute(new PruneOperation());
        long sum = result.values().stream().collect(Collectors.summarizingLong(x -> x)).getSum();
        if (sum > 0) {
            log.info("Removed {} objects ({}).", result.size(), UnitHelper.formatFileSize(sum));
        }
    }

    /**
     * Returns a list of all applications available in the hive
     */
    private Set<Key> getAvailableApps() {
        SortedSet<Key> allKeys = hive.execute(new ManifestListOperation());
        return allKeys.stream().filter(ClientCleanup::isApp).collect(Collectors.toSet());
    }

    /**
     * Returns a list of all launchers available in the hive
     */
    private Set<Key> getAvailableLaunchers() {
        SortedSet<Key> allKeys = hive.execute(new ManifestListOperation());
        return allKeys.stream().filter(ClientCleanup::isLauncher).collect(Collectors.toSet());
    }

    /** Returns whether or not the given manifest refers to a launcher */
    private static boolean isLauncher(Key key) {
        String launcherKey = UpdateHelper.SW_META_PREFIX + UpdateHelper.SW_LAUNCHER;
        return key.getName().startsWith(launcherKey);
    }

    /** Returns whether or not the given manifest refers to an application */
    private static boolean isApp(Key key) {
        return !key.getName().startsWith("meta/");
    }

}