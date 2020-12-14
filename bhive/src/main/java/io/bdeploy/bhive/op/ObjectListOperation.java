package io.bdeploy.bhive.op;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.bdeploy.bhive.BHive;
import io.bdeploy.bhive.ReadOnlyOperation;
import io.bdeploy.bhive.audit.AuditParameterExtractor.AuditStrategy;
import io.bdeploy.bhive.audit.AuditParameterExtractor.AuditWith;
import io.bdeploy.bhive.model.Manifest;
import io.bdeploy.bhive.model.ObjectId;
import io.bdeploy.bhive.model.Tree;
import io.bdeploy.bhive.objects.view.BlobView;
import io.bdeploy.bhive.objects.view.ElementView;
import io.bdeploy.bhive.objects.view.ManifestRefView;
import io.bdeploy.bhive.objects.view.TreeView;
import io.bdeploy.bhive.objects.view.scanner.TreeVisitor;
import io.bdeploy.common.ActivityReporter.Activity;

/**
 * List {@link ObjectId}s available in the {@link BHive}.
 * <p>
 * Typically used to retrieve a flattened list of {@link ObjectId}s recursively
 * required by one or more {@link Manifest}s.
 * <p>
 * If no {@link Manifest} or {@linkplain ObjectId tree} is set, an exception is thrown.
 */
@ReadOnlyOperation
public class ObjectListOperation extends BHive.Operation<Set<ObjectId>> {

    private static final Logger log = LoggerFactory.getLogger(ObjectListOperation.class);

    @AuditWith(AuditStrategy.COLLECTION_PEEK)
    private final Set<Manifest.Key> manifests = new LinkedHashSet<>();

    @AuditWith(AuditStrategy.COLLECTION_SIZE)
    private final Set<ObjectId> trees = new LinkedHashSet<>();

    @AuditWith(AuditStrategy.COLLECTION_SIZE)
    private final Set<ObjectId> treeExcludes = new LinkedHashSet<>();

    @Override
    public Set<ObjectId> call() throws Exception {
        try (Activity activity = getActivityReporter().start("Listing objects...", -1)) {
            if (manifests.isEmpty() && trees.isEmpty()) {
                throw new IllegalStateException("At least one manifest or root tree must be set.");
            }

            // Load all trees that are referenced by the manifest
            for (Manifest.Key m : manifests) {
                trees.add(execute(new ManifestLoadOperation().setManifest(m)).getRoot());
            }

            // Collect all (sub)-trees based on he provided root trees
            // The result is ordered: First the parent tree then it's children
            Map<ObjectId, TreeView> object2Tree = new LinkedHashMap<>();
            for (ObjectId tree : trees) {
                TreeView treeView = execute(new ScanOperation().setTree(tree));
                if (treeView.getElementId() == null) {
                    log.warn("Skipping damaged tree: {}", tree);
                    continue;
                }
                treeView.visit(new TreeVisitor.Builder().onTree((t) -> {
                    // Check if we already have that tree or if it is excluded
                    ObjectId treeId = t.getElementId();
                    if (object2Tree.containsKey(treeId) || treeExcludes.contains(treeId)) {
                        return false;
                    }
                    // Collect and continue
                    object2Tree.put(treeId, t);
                    return true;
                }).build());
            }

            // Reverse the list so that sub-trees are first
            List<TreeView> allTrees = new ArrayList<>(object2Tree.values());
            Collections.reverse(allTrees);

            // Collect all objects referring to the tree
            // First we add the children then we add the parent tree
            // We intentionally do not use a visitor here as we just need the direct children
            Set<ObjectId> result = new LinkedHashSet<>();
            for (TreeView treeView : allTrees) {
                for (ElementView child : treeView.getChildren().values()) {
                    if (child instanceof BlobView) {
                        result.add(child.getElementId());
                    } else if (child instanceof ManifestRefView) {
                        ManifestRefView refView = (ManifestRefView) child;
                        result.add(refView.getReferenceId());
                    }
                }
                result.add(treeView.getElementId());
            }
            return result;
        }
    }

    /**
     * Restrict {@link ObjectId} listing to the given {@link Manifest}(s).
     */
    public ObjectListOperation addManifest(Set<Manifest.Key> manifests) {
        this.manifests.addAll(manifests);
        return this;
    }

    /**
     * Restrict {@link ObjectId} listing to the given {@link Tree}(s).
     */
    public ObjectListOperation addTree(Set<ObjectId> trees) {
        this.trees.addAll(trees);
        return this;
    }

    /**
     * When scanning, exclude the given {@link Tree} and all of it's children.
     */
    public ObjectListOperation excludeTree(Set<ObjectId> trees) {
        this.treeExcludes.addAll(trees);
        return this;
    }

    /**
     * Restrict {@link ObjectId} listing to the given {@link Manifest}(s).
     */
    public ObjectListOperation addManifest(Manifest.Key manifest) {
        manifests.add(manifest);
        return this;
    }

    /**
     * Restrict {@link ObjectId} listing to the given {@link Tree}(s).
     */
    public ObjectListOperation addTree(ObjectId tree) {
        trees.add(tree);
        return this;
    }

    /**
     * When scanning, exclude the given {@link Tree} and all of it's children.
     */
    public ObjectListOperation excludeTree(ObjectId tree) {
        treeExcludes.add(tree);
        return this;
    }

}
