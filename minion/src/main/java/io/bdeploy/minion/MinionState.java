package io.bdeploy.minion;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.SortedMap;
import java.util.TreeMap;

import io.bdeploy.bhive.model.Manifest;
import io.bdeploy.common.security.RemoteService;

/**
 * Represents the persistent state of a minion
 * <p>
 * TODO: split to state, master and slave config. state = runtime data, master/slave config = static.
 */
public class MinionState {

    /**
     * Known other minions. Currently only used on the master minion
     */
    public SortedMap<String, RemoteService> minions = new TreeMap<>();

    /**
     * The own minion's name.
     */
    public String self;

    /**
     * Used only on the master; active versions, i.e. what has been activated
     * already.
     *
     * @deprecated only used to migrate old scheme to new scheme.
     */
    @Deprecated(forRemoval = true, since = "1.2.0")
    public SortedMap<String, Manifest.Key> activeMasterVersions = new TreeMap<>();

    /**
     * Used on all minions, tracking the currently active manifest for each UUID.
     *
     * @deprecated only used to migrate old scheme to new scheme.
     */
    @Deprecated(forRemoval = true, since = "1.2.0")
    public SortedMap<String, Manifest.Key> activeVersions = new TreeMap<>();

    /**
     * Path to the keystore containing the private key and certificates for the
     * minion
     */
    public Path keystorePath;

    /**
     * Passphrase for the keystore
     */
    public char[] keystorePass;

    /**
     * The "official" host name of this minion. This is used to expand variables in
     * configuration.
     */
    public String officialName;

    /**
     * The port to listen on.
     */
    public int port;

    /**
     * Directory where deployments will be put to.
     */
    public Path deploymentDir;

    /**
     * Storage directories hosting hives.
     */
    public List<Path> storageLocations = new ArrayList<>();

    /**
     * 'Cron' format schedule for cleanup job.
     */
    public String cleanupSchedule;

    /**
     * Timestamp of last successful cleanup execution on this minion (only relevant for master).
     */
    public long cleanupLastRun;

    /**
     * The last minion version which was successfully migrated to.
     */
    public String fullyMigratedVersion;
}
