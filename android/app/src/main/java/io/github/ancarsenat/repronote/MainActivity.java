package io.github.ancarsenat.repronote;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Map;

/**
 * The app: starts the local repronote server (embedded Node) once per process,
 * shows its web UI in a WebView, and opens the Pronote/ENT login WebViews the
 * server asks for (it drives them through the DevTools protocol).
 */
public class MainActivity extends Activity implements Bridge.Handler {
    private static final String TAG = "repronote";

    // Process-wide: Node lives as long as the process, across activity instances.
    private static Bridge bridge;
    private static int serverPort;
    private static String accessToken;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<Integer, WebView> logins = new HashMap<>();
    private FrameLayout root;
    private FrameLayout background; // non-interactive login WebViews, hidden under the UI
    private LinearLayout overlay;   // interactive login, shown over the UI
    private FrameLayout overlayContent;
    private WebView ui;
    private Integer interactiveId = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Our driver talks to the login WebViews through DevTools (only reachable
        // from this app, or over adb with USB debugging on).
        WebView.setWebContentsDebuggingEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        buildLayout();
        try {
            startBackend();
        } catch (Exception e) {
            Log.e(TAG, "backend start failed", e);
            Toast.makeText(this, "Impossible de démarrer repronote : " + e.getMessage(), Toast.LENGTH_LONG).show();
            return;
        }
        waitForServerThenLoad();
    }

    private void startBackend() throws Exception {
        if (bridge != null) return;
        accessToken = randomToken();
        String bridgeToken = randomToken();
        bridge = new Bridge(bridgeToken, this);
        try (ServerSocket probe = new ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))) {
            serverPort = probe.getLocalPort();
        }
        Map<String, String> env = new HashMap<>();
        env.put("REPRONOTE_DATA_DIR", new File(getFilesDir(), "data").getAbsolutePath());
        env.put("PORT", Integer.toString(serverPort));
        env.put("REPRONOTE_ACCESS_TOKEN", accessToken);
        env.put("REPRONOTE_BRIDGE_PORT", Integer.toString(bridge.port()));
        env.put("REPRONOTE_BRIDGE_TOKEN", bridgeToken);
        env.put("REPRONOTE_DEBUG", "1"); // login steps in logcat (tag repronote-node)
        NodeRunner.start(this, env);
    }

    private String home() {
        return "http://127.0.0.1:" + serverPort;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void buildLayout() {
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(0xf4, 0xf4, 0xf8));
        background = new FrameLayout(this);
        root.addView(background, match());

        ui = new WebView(this);
        WebSettings s = ui.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        ui.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith(home())) return false;
                // Pronote, links in news...: the phone's browser.
                openExternal(url);
                return true;
            }
        });
        ui.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> download(url, contentDisposition, mimeType));
        ui.loadData("<html><body style='font-family:sans-serif;color:#555;display:flex;align-items:center;justify-content:center;height:90vh'>Démarrage de repronote…</body></html>", "text/html; charset=utf-8", "UTF-8");
        root.addView(ui, match());

        overlay = new LinearLayout(this);
        overlay.setOrientation(LinearLayout.VERTICAL);
        overlay.setBackgroundColor(Color.WHITE);
        overlay.setVisibility(View.GONE);
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        int pad = dp(8);
        bar.setPadding(dp(16), pad, pad, pad);
        TextView title = new TextView(this);
        title.setText("Connexion à Pronote");
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button close = new Button(this);
        close.setText("Annuler");
        close.setOnClickListener(v -> cancelInteractive());
        bar.addView(close);
        overlay.addView(bar);
        overlayContent = new FrameLayout(this);
        overlay.addView(overlayContent, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        root.addView(overlay, match());

        // Keep content out of the status/navigation bars and above the keyboard.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                l = i.left; t = i.top; r = i.right; b = i.bottom;
            } else {
                l = insets.getSystemWindowInsetLeft(); t = insets.getSystemWindowInsetTop();
                r = insets.getSystemWindowInsetRight(); b = insets.getSystemWindowInsetBottom();
            }
            v.setPadding(l, t, r, b);
            return insets;
        });
        setContentView(root);
    }

    private void waitForServerThenLoad() {
        new Thread(() -> {
            for (int i = 0; i < 300; i++) {
                try (Socket s = new Socket()) {
                    s.connect(new InetSocketAddress("127.0.0.1", serverPort), 200);
                    main.post(this::loadUI);
                    return;
                } catch (Exception e) {
                    try {
                        Thread.sleep(200);
                    } catch (InterruptedException ignored) {}
                }
            }
            main.post(() -> ui.loadData("<p style='font-family:sans-serif;padding:2em'>Le serveur local n'a pas démarré. Fermez et rouvrez l'application.</p>", "text/html; charset=utf-8", "UTF-8"));
        }, "wait-server").start();
    }

    private void loadUI() {
        CookieManager cookies = CookieManager.getInstance();
        cookies.setCookie(home(), "repronote_token=" + accessToken + "; Path=/; HttpOnly; SameSite=Strict");
        cookies.flush();
        ui.loadUrl(home() + "/");
        ui.clearHistory();
    }

    // ---- login WebViews (commands from the Node driver) -------------------------

    @Override
    public void onCommand(JSONObject command) {
        Log.i(TAG, "bridge command: " + command);
        main.post(() -> {
            String cmd = command.optString("cmd");
            int id = command.optInt("id");
            if (cmd.equals("open")) openLogin(id, command.optBoolean("interactive"));
            else if (cmd.equals("close")) closeLogin(id, false);
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void openLogin(int id, boolean interactive) {
        WebView wv = new WebView(this);
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true);
        final boolean[] announced = {false};
        wv.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                Log.i(TAG, "login " + id + " page finished: " + url);
                if (!announced[0]) {
                    announced[0] = true;
                    bridge.emit("opened", id);
                }
            }
        });
        logins.put(id, wv);
        if (interactive) {
            if (interactiveId != null) closeLogin(interactiveId, true);
            interactiveId = id;
            overlayContent.addView(wv, match());
            overlay.setVisibility(View.VISIBLE);
        } else {
            background.addView(wv, match());
        }
        // The driver finds this WebView among the DevTools targets by its title.
        wv.loadDataWithBaseURL("about:blank", "<html><head><title>repronote-login-" + id + "</title></head><body></body></html>", "text/html", "UTF-8", null);
    }

    private void closeLogin(int id, boolean byUser) {
        WebView wv = logins.remove(id);
        if (wv == null) return;
        ((ViewGroup) wv.getParent()).removeView(wv);
        wv.destroy();
        if (interactiveId != null && interactiveId == id) {
            interactiveId = null;
            overlay.setVisibility(View.GONE);
        }
        CookieManager.getInstance().flush();
        if (byUser) bridge.emit("closed", id);
    }

    private void cancelInteractive() {
        if (interactiveId != null) closeLogin(interactiveId, true);
    }

    // ---- misc ---------------------------------------------------------------------

    @Override
    public void onBackPressed() {
        if (interactiveId != null) {
            WebView wv = logins.get(interactiveId);
            if (wv != null && wv.canGoBack()) wv.goBack();
            else cancelInteractive();
        } else if (ui.canGoBack()) {
            ui.goBack();
        } else {
            moveTaskToBack(true); // keep the server running
        }
    }

    @Override
    protected void onDestroy() {
        for (Integer id : logins.keySet().toArray(new Integer[0])) closeLogin(id, true);
        super.onDestroy();
    }

    private void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception e) {
            Toast.makeText(this, "Aucune application pour ouvrir ce lien.", Toast.LENGTH_SHORT).show();
        }
    }

    private void download(String url, String contentDisposition, String mimeType) {
        if (!url.startsWith(home())) {
            openExternal(url);
            return;
        }
        String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url))
                .addRequestHeader("Cookie", "repronote_token=" + accessToken)
                .setMimeType(mimeType)
                .setTitle(name)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
        ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(req);
        Toast.makeText(this, "Téléchargement : " + name, Toast.LENGTH_SHORT).show();
    }

    private static FrameLayout.LayoutParams match() {
        return new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private static String randomToken() {
        byte[] b = new byte[24];
        new SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }
}
