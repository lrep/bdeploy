package io.bdeploy.ui.api.impl;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.FileSystem;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

import javax.inject.Inject;
import javax.ws.rs.WebApplicationException;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;
import javax.ws.rs.core.Response.ResponseBuilder;
import javax.ws.rs.core.Response.Status;
import javax.ws.rs.core.StreamingOutput;
import javax.ws.rs.core.UriBuilder;

import org.glassfish.jersey.media.multipart.ContentDisposition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.bdeploy.bhive.BHive;
import io.bdeploy.bhive.model.Manifest;
import io.bdeploy.bhive.model.Manifest.Key;
import io.bdeploy.bhive.op.ExportOperation;
import io.bdeploy.bhive.op.ManifestDeleteOperation;
import io.bdeploy.bhive.op.ManifestListOperation;
import io.bdeploy.bhive.op.PruneOperation;
import io.bdeploy.bhive.remote.jersey.BHiveRegistry;
import io.bdeploy.bhive.remote.jersey.JerseyRemoteBHive;
import io.bdeploy.common.util.OsHelper;
import io.bdeploy.common.util.PathHelper;
import io.bdeploy.common.util.UuidHelper;
import io.bdeploy.interfaces.NodeStatus;
import io.bdeploy.interfaces.ScopedManifestKey;
import io.bdeploy.interfaces.UpdateHelper;
import io.bdeploy.interfaces.remote.MasterRootResource;
import io.bdeploy.ui.api.Minion;
import io.bdeploy.ui.api.SoftwareUpdateResource;

public class SoftwareUpdateResourceImpl implements SoftwareUpdateResource {

    private static final Logger log = LoggerFactory.getLogger(SoftwareUpdateResourceImpl.class);

    private static final String BDEPLOY_MF_NAME = "meta/bdeploy";
    private static final String LAUNCHER_MF_NAME = "meta/launcher";
    private static final Comparator<Key> BY_TAG_NEWEST_LAST = (a, b) -> a.getTag().compareTo(b.getTag());

    @Inject
    private MasterRootResource master;

    @Inject
    private BHiveRegistry reg;

    @Inject
    private Minion minion;

    private BHive getHive() {
        return reg.get(JerseyRemoteBHive.DEFAULT_NAME);
    }

    @Override
    public List<Key> getBDeployVersions() {
        return getHive().execute(new ManifestListOperation().setManifestName(BDEPLOY_MF_NAME)).stream().sorted(BY_TAG_NEWEST_LAST)
                .collect(Collectors.toList());
    }

    @Override
    public List<NodeStatus> getMinionNodes() {
        return new ArrayList<>(master.getMinions().values());
    }

    @Override
    public void updateSelf(List<Key> target) {
        // delegate to the actual master resource
        target.stream().map(ScopedManifestKey::parse).sorted((a, b) -> {
            if (a.getOperatingSystem() != b.getOperatingSystem()) {
                // put own OS last.
                return a.getOperatingSystem() == OsHelper.getRunningOs() ? 1 : -1;
            }
            return a.getKey().toString().compareTo(b.getKey().toString());
        }).forEach(k -> {
            master.update(k.getKey(), false);
        });
    }

    @Override
    public List<Key> getLauncherVersions() {
        return getHive().execute(new ManifestListOperation().setManifestName(LAUNCHER_MF_NAME)).stream()
                .sorted(BY_TAG_NEWEST_LAST).collect(Collectors.toList());
    }

    @Override
    public List<Key> uploadSoftware(InputStream inputStream) {
        String tmpHiveName = UuidHelper.randomId() + ".zip";
        Path targetFile = minion.getDownloadDir().resolve(tmpHiveName);
        Path unpackTmp = minion.getTempDir().resolve(tmpHiveName + "_unpack");
        try {
            // Download the hive to a temporary location
            Files.copy(inputStream, targetFile);
            return Collections.singletonList(UpdateHelper.importUpdate(targetFile, unpackTmp, getHive()));
        } catch (IOException e) {
            throw new WebApplicationException("Failed to upload file: " + e.getMessage(), Status.BAD_REQUEST);
        } finally {
            PathHelper.deleteRecursive(unpackTmp);
            PathHelper.deleteRecursive(targetFile);
        }
    }

    @Override
    public void deleteVersions(List<Manifest.Key> keys) {
        BHive hive = getHive();
        keys.forEach(k -> hive.execute(new ManifestDeleteOperation().setToDelete(k)));
        hive.execute(new PruneOperation());
    }

    @Override
    public Response downloadSoftware(String name, String tag) {
        Manifest.Key key = new Manifest.Key(name, tag);
        Path targetFile = minion.getTempDir().resolve(key.directoryFriendlyName() + ".zip");

        File file = targetFile.toFile();
        if (!file.isFile()) {
            try {
                // build ZIP from key.
                Path tmpFile = Files.createTempFile(minion.getTempDir(), "sw-", ".zip");
                Path tmpFolder = minion.getTempDir().resolve(key.directoryFriendlyName());

                try {
                    PathHelper.deleteRecursive(tmpFile);

                    Map<String, Object> env = new TreeMap<>();
                    env.put("create", "true");
                    env.put("useTempFile", Boolean.TRUE);
                    try (FileSystem zfs = FileSystems.newFileSystem(UriBuilder.fromUri("jar:" + tmpFile.toUri()).build(), env)) {
                        Path exportTo = zfs.getPath("/").resolve(key.directoryFriendlyName());
                        getHive().execute(new ExportOperation().setManifest(key).setTarget(exportTo));
                    }
                    Files.copy(tmpFile, targetFile);
                } finally {
                    Files.deleteIfExists(tmpFile);
                    PathHelper.deleteRecursive(tmpFolder);
                }
            } catch (Exception e) {
                log.error("Failed to package download", e);
                throw new WebApplicationException("Error packaging download", e);
            }
        }

        long lastModified = file.lastModified();
        long validUntil = lastModified + TimeUnit.MINUTES.toMillis(5);
        if (System.currentTimeMillis() > validUntil) {
            throw new WebApplicationException("Token to download product is not valid any more.", Status.BAD_REQUEST);
        }

        // Build a response with the stream
        ResponseBuilder responeBuilder = Response.ok(new StreamingOutput() {

            @Override
            public void write(OutputStream output) throws IOException, WebApplicationException {
                try (InputStream is = Files.newInputStream(targetFile)) {
                    is.transferTo(output);
                } catch (IOException ioe) {
                    if (log.isDebugEnabled()) {
                        log.debug("Could not fully write output", ioe);
                    } else {
                        log.warn("Could not fully write output: " + ioe.toString());
                    }
                }
            }
        }, MediaType.APPLICATION_OCTET_STREAM);

        // Load and attach metadata to give the file a nice name
        ContentDisposition contentDisposition = ContentDisposition.type("attachement").size(file.length())
                .fileName(targetFile.getFileName().toString()).build();
        responeBuilder.header("Content-Disposition", contentDisposition);
        responeBuilder.header("Content-Length", file.length());
        return responeBuilder.build();
    }

}
