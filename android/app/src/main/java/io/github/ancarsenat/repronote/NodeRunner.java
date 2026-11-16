package io.github.ancarsenat.repronote;

import android.content.Context;
import android.content.res.AssetManager;
import android.system.Os;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Map;

/**
 * Runs the repronote server (dist/android.mjs) in the embedded Node runtime.
 * Node can only be started once per process, so this is a process-wide singleton.
 */
final class NodeRunner {
    private static final String TAG = "repronote";
    private static boolean started = false;

    static {
        System.loadLibrary("node");
        System.loadLibrary("native-lib");
    }

    private static native int startNode(String[] arguments);

    private NodeRunner() {}

    static synchronized void start(Context context, Map<String, String> env) {
        if (started) return;
        started = true;
        File project = new File(context.getFilesDir(), "nodejs-project");
        try {
            copyAssetsIfUpdated(context, project);
            for (Map.Entry<String, String> e : env.entrySet()) Os.setenv(e.getKey(), e.getValue(), true);
            Os.setenv("HOME", context.getFilesDir().getAbsolutePath(), true);
        } catch (Exception e) {
            Log.e(TAG, "Could not prepare the Node project", e);
            return;
        }
        String script = new File(project, "dist/android.mjs").getAbsolutePath();
        // Node wants a big stack; the default thread stack is too small.
        Thread t = new Thread(null, () -> {
            int code = startNode(new String[] {"node", script});
            Log.e(TAG, "Node exited with code " + code);
        }, "node", 16 * 1024 * 1024);
        t.setDaemon(true);
        t.start();
    }

    /** Copies assets/nodejs-project to the files dir when the app was installed or updated. */
    private static void copyAssetsIfUpdated(Context context, File target) throws Exception {
        long updated = context.getPackageManager().getPackageInfo(context.getPackageName(), 0).lastUpdateTime;
        File stamp = new File(context.getFilesDir(), "nodejs-project.stamp");
        if (target.exists() && stamp.exists() && readStamp(stamp) == updated) return;
        deleteRecursively(target);
        copyAssetDir(context.getAssets(), "nodejs-project", target);
        try (OutputStream out = new FileOutputStream(stamp)) {
            out.write(Long.toString(updated).getBytes());
        }
    }

    private static long readStamp(File f) {
        try (InputStream in = new java.io.FileInputStream(f)) {
            return Long.parseLong(new String(in.readAllBytes()).trim());
        } catch (Exception e) {
            return -1;
        }
    }

    private static void copyAssetDir(AssetManager assets, String path, File target) throws IOException {
        String[] children = assets.list(path);
        if (children == null || children.length == 0) {
            target.getParentFile().mkdirs();
            try (InputStream in = assets.open(path); OutputStream out = new FileOutputStream(target)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            return;
        }
        target.mkdirs();
        for (String child : children) copyAssetDir(assets, path + "/" + child, new File(target, child));
    }

    private static void deleteRecursively(File f) {
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteRecursively(c);
        f.delete();
    }
}
