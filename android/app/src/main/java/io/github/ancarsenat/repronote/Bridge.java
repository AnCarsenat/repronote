package io.github.ancarsenat.repronote;

import android.net.LocalSocket;
import android.net.LocalSocketAddress;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Localhost TCP port the Node backend connects to. Every connection starts with
 * "<token> <mode>\n" (other apps can reach localhost too):
 * - "control": newline-delimited JSON commands (open/close login WebViews) and events back
 * - "cdp": piped to the WebViews' DevTools socket (Node 18 can't open abstract sockets)
 */
final class Bridge {
    interface Handler {
        void onCommand(JSONObject command);
    }

    private static final String TAG = "repronote";
    private final String token;
    private final Handler handler;
    private final ServerSocket server;
    private volatile OutputStream controlOut;
    private final ExecutorService writer = Executors.newSingleThreadExecutor();

    Bridge(String token, Handler handler) throws IOException {
        this.token = token;
        this.handler = handler;
        this.server = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
        Thread t = new Thread(this::acceptLoop, "bridge");
        t.setDaemon(true);
        t.start();
    }

    int port() {
        return server.getLocalPort();
    }

    /** Sends an event to Node on the control channel (off the main thread: Android forbids network I/O there). */
    void emit(String event, int id) {
        writer.execute(() -> {
            OutputStream out = controlOut;
            if (out == null) return;
            try {
                out.write((new JSONObject().put("event", event).put("id", id).toString() + "\n").getBytes(StandardCharsets.UTF_8));
                out.flush();
            } catch (Exception e) {
                Log.w(TAG, "control write failed", e);
            }
        });
    }

    private void acceptLoop() {
        while (true) {
            try {
                Socket s = server.accept();
                Thread t = new Thread(() -> handle(s), "bridge-conn");
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                Log.e(TAG, "bridge accept failed", e);
                return;
            }
        }
    }

    private void handle(Socket s) {
        try {
            InputStream in = s.getInputStream();
            String hello = readLine(in, 256);
            int space = hello == null ? -1 : hello.indexOf(' ');
            if (space < 0 || !MessageDigest.isEqual(hello.substring(0, space).getBytes(), token.getBytes())) {
                s.close();
                return;
            }
            String mode = hello.substring(space + 1);
            if (mode.equals("control")) control(s, in);
            else if (mode.equals("cdp")) cdp(s, in);
            else s.close();
        } catch (Exception e) {
            Log.w(TAG, "bridge connection failed", e);
            try {
                s.close();
            } catch (IOException ignored) {}
        }
    }

    private void control(Socket s, InputStream in) throws IOException {
        controlOut = s.getOutputStream();
        BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        String line;
        while ((line = reader.readLine()) != null) {
            try {
                handler.onCommand(new JSONObject(line));
            } catch (Exception e) {
                Log.w(TAG, "bad control command", e);
            }
        }
    }

    private void cdp(Socket s, InputStream in) throws IOException {
        LocalSocket devtools = new LocalSocket();
        Log.i(TAG, "cdp connection");
        devtools.connect(new LocalSocketAddress("webview_devtools_remote_" + android.os.Process.myPid(), LocalSocketAddress.Namespace.ABSTRACT));
        Thread up = pipe(in, devtools.getOutputStream(), () -> closeQuietly(devtools));
        pipe(devtools.getInputStream(), s.getOutputStream(), () -> closeQuietly(s));
        try {
            up.join();
        } catch (InterruptedException ignored) {}
    }

    private static Thread pipe(InputStream from, OutputStream to, Runnable onEnd) {
        Thread t = new Thread(() -> {
            byte[] buf = new byte[64 * 1024];
            int n;
            try {
                while ((n = from.read(buf)) > 0) {
                    to.write(buf, 0, n);
                    to.flush();
                }
            } catch (IOException ignored) {
            } finally {
                onEnd.run();
            }
        }, "bridge-pipe");
        t.setDaemon(true);
        t.start();
        return t;
    }

    private static void closeQuietly(java.io.Closeable c) {
        try {
            c.close();
        } catch (IOException ignored) {}
    }

    private static String readLine(InputStream in, int max) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int b;
        while ((b = in.read()) != -1 && b != '\n') {
            if (buf.size() >= max) return null;
            buf.write(b);
        }
        return b == -1 ? null : buf.toString("UTF-8");
    }
}
