package io.github.ancarsenat.repronote;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Installs an update APK that the Node side downloaded and checked (SHA-256
 * from GitHub), with PackageInstaller. The app's files and data stay: the APK
 * is signed with the same key.
 *
 * The first time, Android asks the user to allow repronote to install apps,
 * then to confirm the update. On Android 12+ later updates can install without
 * a confirmation (USER_ACTION_NOT_REQUIRED), since repronote installed itself.
 */
final class Updater {
    private static final String TAG = "repronote";
    static final String ACTION_STATUS = "io.github.ancarsenat.repronote.INSTALL_STATUS";

    private Updater() {}

    static void install(Context context, String path) {
        new Thread(() -> {
            try {
                File apk = new File(path);
                if (!apk.isFile()) throw new IllegalArgumentException("APK introuvable");
                if (Build.VERSION.SDK_INT >= 26 && !context.getPackageManager().canRequestPackageInstalls()) {
                    // Settings screen "Allow from this source"; the next check retries.
                    Intent allow = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()))
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(allow);
                    Notifications.show(context, "Mise à jour de repronote",
                            "Autorisez repronote à installer des applications, puis relancez la mise à jour (Réglages → À propos).");
                    return;
                }
                PackageInstaller installer = context.getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setAppPackageName(context.getPackageName());
                if (Build.VERSION.SDK_INT >= 31) {
                    params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
                }
                int id = installer.createSession(params);
                try (PackageInstaller.Session session = installer.openSession(id)) {
                    try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("repronote.apk", 0, apk.length())) {
                        byte[] buf = new byte[1 << 16];
                        int n;
                        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                        session.fsync(out);
                    }
                    Intent status = new Intent(context, Status.class).setAction(ACTION_STATUS);
                    int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                    PendingIntent pending = PendingIntent.getBroadcast(context, id, status, flags);
                    session.commit(pending.getIntentSender());
                }
            } catch (Exception e) {
                Log.e(TAG, "update install failed", e);
                Notifications.show(context, "La mise à jour de repronote a échoué", String.valueOf(e.getMessage()));
            }
        }, "repronote-update").start();
    }

    /** PackageInstaller's answer: show the confirmation screen, or report a failure. */
    public static final class Status extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm == null) return;
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    context.startActivity(confirm);
                } catch (Exception e) {
                    // In the background Android may block it: tell the user instead.
                    Notifications.show(context, "Mise à jour de repronote prête", "Ouvrez repronote pour la confirmer.");
                }
            } else if (status != PackageInstaller.STATUS_SUCCESS) {
                String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                Log.w(TAG, "update install status " + status + ": " + message);
                if (status != PackageInstaller.STATUS_FAILURE_ABORTED) {
                    Notifications.show(context, "La mise à jour de repronote a échoué", message == null ? "Erreur " + status : message);
                }
            }
        }
    }

    /** The app was just updated (and its process stopped): offer to open it again. */
    public static final class Replaced extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            Notifications.show(context, "repronote est à jour", "Touchez pour l'ouvrir. Vos données sont conservées.");
        }
    }
}
