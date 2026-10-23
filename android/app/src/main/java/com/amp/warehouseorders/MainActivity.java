package com.amp.warehouseorders;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.graphics.Rect;
import java.util.Collections;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import androidx.appcompat.app.AppCompatActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.firebase.installations.FirebaseInstallations;
import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends AppCompatActivity {
    private static final String SITE_URL = "https://hlebish.github.io/warehouse_orders/";
    private static final String CHANNEL_ID = "warehouse_orders_v4";
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1001;
    private static final String PREFS = "warehouse_push";
    private static final String PREF_TOKEN = "token";
    private static final String PREF_INSTALLATION = "installationId";

    private WebView webView;

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
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidWarehouse");
        webView.loadUrl(SITE_URL);
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

    @Override
    protected void onResume() {
        super.onResume();
        sendCachedTokenToSite();
        requestNativePushToken();
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
            // Leave the channel sound unset so Android uses the device default notification sound.

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
        public void requestNativePushToken() {
            MainActivity.this.requestNativePushToken();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidWarehouse");
            webView.destroy();
        }
        super.onDestroy();
    }
}
