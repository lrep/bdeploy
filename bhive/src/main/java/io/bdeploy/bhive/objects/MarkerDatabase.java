package io.bdeploy.bhive.objects;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Collections;
import java.util.List;
import java.util.function.Predicate;
import java.util.function.Supplier;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.bdeploy.bhive.model.ObjectId;
import io.bdeploy.common.ActivityReporter;
import io.bdeploy.common.util.PathHelper;
import io.bdeploy.common.util.StringHelper;

public class MarkerDatabase extends ObjectDatabase {

    private static final Logger log = LoggerFactory.getLogger(MarkerDatabase.class);
    private static final String LOCK_FILE = ".lock";

    public MarkerDatabase(Path root, ActivityReporter reporter) {
        super(root, root.resolve("tmp"), reporter);
    }

    public void addMarker(ObjectId id) {
        Path markerFile = getObjectFile(id);
        PathHelper.mkdirs(markerFile.getParent());
        try {
            Files.createFile(markerFile);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot add marker for " + id, e);
        }
    }

    @Override
    public InputStream getStream(ObjectId id) throws IOException {
        throw new UnsupportedOperationException("Marker-only Database");
    }

    @Override
    protected ObjectId internalAddObject(ObjectWriter writer) throws IOException {
        throw new UnsupportedOperationException("Marker-only Database");
    }

    @Override
    public void removeObject(ObjectId id) {
        throw new UnsupportedOperationException("Marker-only Database");
    }

    /**
     * Lock a directory. The lock can be awaited using {@link #waitRootLock(Path)}.
     * <p>
     * The method waits for an already existing lock to disappear before proceeding (max 1000 seconds, ~16 minutes). This means
     * only a single lock can exist (intra- & inter-VM).
     *
     * @param root the root directory to lock.
     * @param lockContentSupplier supplies content to be written to the lock file.
     * @param lockContentValidator validates the content of the lock file (even from other VMs!) to check whether the file is
     *            still valid. The lock file is forcefully deleted if not.
     */
    public static void lockRoot(Path root, Supplier<String> lockContentSupplier, Predicate<String> lockContentValidator) {
        Path lockFile = root.resolve(LOCK_FILE);

        String content = "";
        if (lockContentSupplier != null) {
            content = lockContentSupplier.get();
        }

        boolean infoWritten = false;
        for (int i = 0; i < 100_000; ++i) {
            try {
                Files.write(lockFile, Collections.singletonList(content), StandardOpenOption.CREATE_NEW,
                        StandardOpenOption.DELETE_ON_CLOSE);
                return;
            } catch (FileAlreadyExistsException e) {
                // validate to find stale lock files
                if (lockContentValidator != null) {
                    try {
                        List<String> lines = Files.readAllLines(lockFile);
                        if (!lines.isEmpty() && !StringHelper.isNullOrEmpty(lines.get(0))
                                && !lockContentValidator.test(lines.get(0))) {
                            // it is invalid! this means it is a stale lock, we can delete it!
                            log.warn("Stale lock file detected, forcefully resolving...");
                            Files.delete(lockFile);
                            continue;
                        }
                    } catch (IOException ve) {
                        // cannot validate, assume it is still valid.
                        log.warn("Cannot validate lock file, assuming it is valid: {}: {}", lockFile, ve.toString());
                    }
                }
                // inform the user that we're about to wait...
                if (!infoWritten) {
                    log.info("Waiting for {}", root);
                    infoWritten = true;
                }
                // delay a little...
                try {
                    Thread.sleep(10);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            } catch (Exception e) {
                throw new IllegalStateException("Cannot lock root", e);
            }
        }

        throw new IllegalStateException("Retries exceeded or interrupted, failed to lock marker root");
    }

    /**
     * Wait for a root lock to disappear (max 1000 seconds, ~16 minutes).
     *
     * @param root the root to wait for
     */
    public static void waitRootLock(Path root) {
        Path lockFile = root.resolve(LOCK_FILE);
        for (int i = 0; i < 100_000; ++i) {
            if (Files.exists(lockFile)) {
                try {
                    Thread.sleep(10);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            } else {
                return;
            }
        }

        throw new IllegalStateException("Retries exceeded or interrupted, failed to wait for marker root lock");
    }

    /**
     * @param root root to unlock
     */
    public static void unlockRoot(Path root) {
        PathHelper.deleteRecursive(root.resolve(LOCK_FILE));
    }

}
