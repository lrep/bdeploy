package io.bdeploy.minion;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import io.bdeploy.bhive.model.ObjectId;
import io.bdeploy.ui.api.MinionMode;

/**
 * Represents the persistent state of a minion
 */
public class MinionState {

    /**
     * The own minion's name.
     */
    public String self;

    /**
     * The minions mode.
     * <p>
     * Defaults to {@link MinionMode#STANDALONE} for compatibility.
     */
    public MinionMode mode = MinionMode.STANDALONE;

    /**
     * Path to the keystore containing the private key and certificates for the
     * minion
     */
    public Path keystorePath;

    /**
     * Optional secondary keystore containing information for HTTPS *only*.
     */
    public Path keystoreHttpsPath;

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
     * Minimum available disc space on working directories.
     */
    public Long storageMinFree = 1l * 1024 * 1024 * 1024;

    /**
     * 'Cron' format schedule for cleanup job.
     */
    public String cleanupSchedule;

    /**
     * Timestamp of last successful cleanup execution on this minion (only relevant for master).
     */
    public long cleanupLastRun;

    /**
     * 'Cron' format schedule for LDAP Synchronization Job.
     */
    public String ldapSyncSchedule;

    /**
     * Timestamp of last successful execution of LDAP Synchronization Job on this minion.
     */
    public long ldapSyncLastRun;

    /**
     * The last minion version which was successfully migrated to.
     */
    public String fullyMigratedVersion;

    /**
     * The last known {@link ObjectId} of the built-in logging configuration.
     */
    public ObjectId logConfigId;

    /**
     * The timeout of web sessions in hours. Defaults to a week.
     */
    public Integer webSessionTimeoutHours = 24 * 7;

    /**
     * The timeout of web sessions within which a user needs to be active to have the session be kept alive.
     */
    public Integer webSessionActiveTimeoutHours = 24 * 1;
}
