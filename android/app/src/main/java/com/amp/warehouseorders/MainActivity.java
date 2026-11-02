package com.amp.warehouseorders;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.SharedPreferences;
import android.content.Intent;
import android.content.ClipData;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.graphics.Rect;
import java.util.Collections;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.ValueCallback;
import android.net.Uri;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import androidx.appcompat.app.AppCompatActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.firebase.installations.FirebaseInstallations;
import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends AppCompatActivity {
    private static final String SITE_URL = "https://hlebish.github.io/warehouse_orders/";
    private static final String CHANNEL_ID = "warehouse_orders_v8_custom_sound";
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1001;
    private static final String PREFS = "warehouse_push";
    private static final String PREF_TOKEN = "token";
    private static final String PREF_INSTALLATION = "installationId";
    private static final int GOOGLE_SIGN_IN_REQUEST = 1002;
    private static final int FILE_CHOOSER_REQUEST = 1003;
    private static final String GOOGLE_WEB_CLIENT_ID = "329606730319-bqe5c2lkngq4jk87atifp6n9qnn3chfh.apps.googleusercontent.com";

    private WebView webView;
    private GoogleSignInClient googleSignInClient;
    private ValueCallback<Uri[]> filePathCallback;
    private final ExecutorService shareExecutor = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Keep the web app content below the status bar, camera cutout and gesture/navigation area.
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        if (Build.VERSION.SDK_INT >= 21) {
            getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS | android.view.WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
            getWindow().setStatusBarColor(android.graphics.Color.rgb(17, 19, 21));
            getWindow().setNavigationBarColor(android.graphics.Color.rgb(17, 19, 21));
            getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(android.graphics.Color.rgb(17, 19, 21)));
            androidx.core.view.WindowInsetsControllerCompat bars = androidx.core.view.WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            bars.setAppearanceLightStatusBars(false);
            bars.setAppearanceLightNavigationBars(false);
        }
        createNotificationChannel();
        requestNotificationPermission();
        GoogleSignInOptions googleOptions = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestEmail()
            .requestIdToken(GOOGLE_WEB_CLIENT_ID)
            .build();
        googleSignInClient = GoogleSignIn.getClient(this, googleOptions);

        webView = new WebView(this);
        webView.setBackgroundColor(android.graphics.Color.rgb(17, 19, 21));
        setContentView(webView);
        if (Build.VERSION.SDK_INT >= 29) {
            webView.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
                int edgeWidth = (int) (32 * getResources().getDisplayMetrics().density);
                view.setSystemGestureExclusionRects(Collections.singletonList(
                    new Rect(0, 0, edgeWidth, Math.max(0, bottom - top))
                ));
            });
        }
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " WarehouseOrdersAndroid");
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams fileChooserParams) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = callback;
                try {
                    Intent chooserIntent = fileChooserParams.createIntent();
                    startActivityForResult(chooserIntent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception error) {
                    MainActivity.this.filePathCallback = null;
                    return false;
                }
            }
        });
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidWarehouse");
        // Restore the page after Android recreates this Activity to avoid a fresh startup.
        boolean restoredWebView = savedInstanceState != null && webView.restoreState(savedInstanceState) != null;
        if (!restoredWebView) webView.loadUrl(notificationUrlFrom(getIntent()));
        installBackHandler();
        requestNativePushToken();
    }

    private void installBackHandler() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView != null) {
                    webView.evaluateJavascript(
                        "window.handleNativeBack ? window.handleNativeBack() : false",
                        null
                    );
                }
            }
        });
    }

    private String notificationUrlFrom(android.content.Intent intent) {
        String candidate = intent == null ? null : intent.getStringExtra("notification_link");
        if (candidate == null || candidate.isEmpty()) return SITE_URL;
        try {
            android.net.Uri uri = android.net.Uri.parse(candidate);
            if ("https".equalsIgnoreCase(uri.getScheme())
                    && "hlebish.github.io".equalsIgnoreCase(uri.getHost())
                    && (uri.getPath() == null || uri.getPath().equals("/warehouse_orders/") || uri.getPath().equals("/warehouse_orders"))) {
                return candidate;
            }
        } catch (Exception ignored) { }
        return SITE_URL;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // A notification tap must not reload the whole web app. Route it inside
        // the already-running page so its auth session, cache and open UI survive.
        String notificationLink = intent == null ? null : intent.getStringExtra("notification_link");
        if (notificationLink == null || notificationLink.isEmpty() || webView == null) return;
        String safeUrl = notificationUrlFrom(intent);
        webView.post(() -> {
            String currentUrl = webView.getUrl();
            if (currentUrl == null || currentUrl.equals("about:blank")) {
                webView.loadUrl(safeUrl);
                return;
            }
            webView.evaluateJavascript(
                "window.handleNativeNotificationLink && window.handleNativeNotificationLink(" +
                    JSONObject.quote(safeUrl) + ")",
                null
            );
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        sendCachedTokenToSite();
        requestNativePushToken();
    }

    private void downloadAndSharePhoto(String imageUrl, String caption) {
        File imageFile = null;
        HttpURLConnection connection = null;
        try {
            URL url = new URL(imageUrl);
            String host = url.getHost();
            if (!"https".equalsIgnoreCase(url.getProtocol()) ||
                    !("firebasestorage.googleapis.com".equalsIgnoreCase(host) ||
                      "storage.googleapis.com".equalsIgnoreCase(host))) {
                throw new IllegalArgumentException("Unsupported photo URL");
            }
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(true);
            connection.connect();
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("Photo download failed: " + status);
            String contentType = connection.getContentType();
            if (contentType == null || !contentType.toLowerCase().startsWith("image/"))
                throw new IllegalStateException("The link does not point to an image");
            int length = connection.getContentLength();
            if (length > 20 * 1024 * 1024) throw new IllegalStateException("Photo is larger than 20 MB");
            imageFile = File.createTempFile("warehouse-viber-", ".jpg", getCacheDir());
            try (InputStream input = connection.getInputStream();
                 FileOutputStream output = new FileOutputStream(imageFile)) {
                byte[] buffer = new byte[8192];
                int total = 0, count;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > 20 * 1024 * 1024) throw new IllegalStateException("Photo is larger than 20 MB");
                    output.write(buffer, 0, count);
                }
            }
            Uri contentUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", imageFile);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(contentType);
            send.putExtra(Intent.EXTRA_STREAM, contentUri);
            send.putExtra(Intent.EXTRA_TEXT, caption == null ? "Фото дефекта" : caption);
            send.setClipData(ClipData.newUri(getContentResolver(), "Фото дефекта", contentUri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            send.setPackage("com.viber.voip");
            Intent launch = send;
            if (send.resolveActivity(getPackageManager()) == null) {
                launch = Intent.createChooser(send.setPackage(null), "Отправить фотографию");
            }
            final Intent finalLaunch = launch;
            runOnUiThread(() -> {
                try {
                    startActivity(finalLaunch);
                } catch (Exception error) {
                    android.widget.Toast.makeText(this, "Не удалось открыть отправку фото в Viber", android.widget.Toast.LENGTH_LONG).show();
                }
            });
        } catch (Exception error) {
            android.util.Log.e("WarehouseOrders", "Unable to share photo to Viber", error);
            runOnUiThread(() -> android.widget.Toast.makeText(this,
                "Не удалось подготовить фотографию для Viber", android.widget.Toast.LENGTH_LONG).show());
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Заказы · Склад",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Уведомления заказов и чата");
            channel.enableVibration(true);
            // Keep the app's original notification tone. A new channel ID ensures
            // Android doesn't keep the previously saved system-sound channel settings.
            Uri soundUri = Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.delivered_message_sound);
            android.media.AudioAttributes audioAttributes = new android.media.AudioAttributes.Builder()
                .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            channel.setSound(soundUri, audioAttributes);

            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                this,
                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                NOTIFICATION_PERMISSION_REQUEST
            );
        }
    }

    private void cacheToken(String token, String installationId) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString(PREF_TOKEN, token)
            .putString(PREF_INSTALLATION, installationId == null ? "" : installationId)
            .apply();
    }

    private void sendCachedTokenToSite() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String token = prefs.getString(PREF_TOKEN, "");
        String installationId = prefs.getString(PREF_INSTALLATION, "");
        if (!token.isEmpty()) sendTokenToSite(token, installationId);
    }

    private void sendTokenToSite(String token, String installationId) {
        if (webView == null) return;
        String js = "window.registerNativePushToken && window.registerNativePushToken(" +
            JSONObject.quote(token) + "," + JSONObject.quote(installationId) + ")";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    private void requestNativePushToken() {
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful()) return;
            String token = task.getResult();

            FirebaseInstallations.getInstance().getId().addOnCompleteListener(idTask -> {
                String installationId = idTask.isSuccessful() ? idTask.getResult() : "";
                cacheToken(token, installationId);
                sendTokenToSite(token, installationId);
            });
        });
    }

    private class AndroidBridge {
        @JavascriptInterface
        public void startGoogleSignIn() {
            runOnUiThread(() -> {
                android.util.Log.i("WarehouseOrders", "Starting native Google sign-in");
                startActivityForResult(googleSignInClient.getSignInIntent(), GOOGLE_SIGN_IN_REQUEST);
            });
        }

        @JavascriptInterface
        public void requestNativePushToken() {
            MainActivity.this.requestNativePushToken();
        }

        @JavascriptInterface
        public void sharePhotoToViber(String imageUrl, String caption) {
            if (imageUrl == null || imageUrl.isEmpty()) return;
            shareExecutor.execute(() -> downloadAndSharePhoto(imageUrl, caption));
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, android.content.Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null) {
                    results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                    // Some Android photo-picker providers return the selected URI only
                    // through Intent data/ClipData; preserve it if parseResult is empty.
                    if (results == null || results.length == 0) {
                        ClipData clipData = data.getClipData();
                        if (clipData != null && clipData.getItemCount() > 0) {
                            results = new Uri[clipData.getItemCount()];
                            for (int i = 0; i < clipData.getItemCount(); i++) {
                                results[i] = clipData.getItemAt(i).getUri();
                            }
                        } else if (data.getData() != null) {
                            results = new Uri[]{data.getData()};
                        }
                    }
                }
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
            return;
        }
        if (requestCode != GOOGLE_SIGN_IN_REQUEST) return;
        try {
            GoogleSignInAccount account = GoogleSignIn.getSignedInAccountFromIntent(data).getResult(ApiException.class);
            String idToken = account == null ? null : account.getIdToken();
            if (idToken == null || idToken.isEmpty()) throw new IllegalStateException("Google did not return an ID token");
            if (webView != null) webView.post(() -> webView.evaluateJavascript(
                "window.handleNativeGoogleSignIn && window.handleNativeGoogleSignIn(" + JSONObject.quote(idToken) + ")", null));
        } catch (Exception error) {
            String message = error instanceof ApiException ? "Google Sign-In failed (" + ((ApiException) error).getStatusCode() + ")" : "Google Sign-In failed";
            if (webView != null) webView.post(() -> webView.evaluateJavascript(
                "window.handleNativeGoogleSignInError && window.handleNativeGoogleSignInError(" + JSONObject.quote(message) + ")", null));
        }
    }

    @Override
    protected void onDestroy() {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidWarehouse");
            webView.destroy();
            shareExecutor.shutdown();
        }
        super.onDestroy();
    }
}
