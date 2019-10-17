package io.bdeploy.minion.remote.jersey;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.SortedMap;
import java.util.SortedSet;
import java.util.TreeSet;
import java.util.stream.Collectors;

import javax.inject.Inject;

import io.bdeploy.bhive.BHive;
import io.bdeploy.bhive.meta.MetaManifest;
import io.bdeploy.bhive.model.Manifest.Key;
import io.bdeploy.bhive.op.ManifestDeleteOperation;
import io.bdeploy.bhive.op.ManifestListOperation;
import io.bdeploy.bhive.op.ManifestRefScanOperation;
import io.bdeploy.bhive.op.PruneOperation;
import io.bdeploy.common.Version;
import io.bdeploy.common.util.PathHelper;
import io.bdeploy.dcu.InstanceNodeController;
import io.bdeploy.interfaces.cleanup.CleanupAction;
import io.bdeploy.interfaces.cleanup.CleanupAction.CleanupType;
import io.bdeploy.interfaces.remote.SlaveCleanupResource;
import io.bdeploy.minion.MinionRoot;

public class SlaveCleanupResourceImpl implements SlaveCleanupResource {

    @Inject
    private MinionRoot root;

    @Override
    public List<CleanupAction> cleanup(SortedSet<Key> toKeep, boolean immediate) {
        List<CleanupAction> notExecuted = new ArrayList<>();

        BHive hive = root.getHive();

        Set<String> newestLauncherTags = hive.execute(new ManifestListOperation().setManifestName("meta/launcher")).stream() //
                .map(key -> key.getTag()) //
                .collect(Collectors.toCollection(() -> new TreeSet<>((a, b) -> Version.parse(b).compareTo(Version.parse(a))))) // reverse order
                .stream().limit(2).collect(Collectors.toSet());

        SortedSet<Key> allMfs = hive.execute(new ManifestListOperation()); // list ALL

        // filter some well-known things.
        SortedSet<Key> toClean = allMfs.stream() //
                .filter(this::isNotWellKnown) //
                .filter(key -> !newestLauncherTags.contains(key.getTag())) //
                .collect(Collectors.toCollection(TreeSet::new));

        SortedSet<Key> allRefs = new TreeSet<>();
        for (Key keep : toKeep) {
            // toKepp may contain way more manifests than actually exist in our hive, since it's the list of all manifests in all groups
            if (!allMfs.contains(keep)) {
                continue;
            }
            SortedMap<String, Key> refs = hive.execute(new ManifestRefScanOperation().setManifest(keep));
            allRefs.add(keep);
            allRefs.addAll(refs.values());
        }

        toClean.removeAll(allRefs);
        for (Key clean : toClean) {
            if (MetaManifest.isMetaManifest(clean) && MetaManifest.isParentAlive(clean, hive, toClean)) {
                continue;
            }
            notExecuted.add(new CleanupAction(CleanupType.DELETE_MANIFEST, clean.toString(), "Delete manifest " + clean));
        }

        // after manifests, cleanup dist (deployment dir, temp, download, ...).
        notExecuted.addAll(InstanceNodeController.cleanup(hive, root.getDeploymentDir(), toClean));

        if (immediate) {
            perform(notExecuted);
            return Collections.emptyList();
        }

        return notExecuted;
    }

    private boolean isNotWellKnown(Key key) {
        // TODO: unify...?
        return !((key.getName().startsWith("meta/") && !key.getName().startsWith("meta/launcher"))
                || key.getName().startsWith("users/"));
    }

    @Override
    public void perform(List<CleanupAction> actions) {
        boolean needPrune = false;
        for (CleanupAction action : actions) {
            switch (action.type) {
                case DELETE_FOLDER:
                    doDeleteFolder(Paths.get(action.what));
                    break;
                case DELETE_MANIFEST:
                    needPrune = true;
                    doDeleteManifest(root.getHive(), Key.parse(action.what));
                    break;
                default:
                    throw new IllegalStateException("CleanupType " + action.type + " not supported here");
            }
        }

        if (needPrune) {
            root.getHive().execute(new PruneOperation());
        }
    }

    private void doDeleteManifest(BHive hive, Key key) {
        hive.execute(new ManifestDeleteOperation().setToDelete(key));
    }

    private void doDeleteFolder(Path path) {
        // check folder location and permission
        if (!root.isManagedPath(path)) {
            throw new IllegalStateException("Path to delete is not under minion's control: " + path);
        }

        PathHelper.deleteRecursive(path);
    }

}
