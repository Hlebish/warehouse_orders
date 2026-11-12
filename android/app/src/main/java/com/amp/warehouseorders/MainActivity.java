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
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.graphics.Rect;
import android.graphics.Color;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.Collections;
import java.util.ArrayList;
import java.util.List;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
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
import org.json.JSONArray;

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
    private static final String ANDROID_RELEASES_URL = "https://api.github.com/repos/Hlebish/warehouse_orders/releases?per_page=50";
    private static final String CHANNEL_ID = "warehouse_orders_v8_custom_sound";
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1001;
    private static final String PREFS = "warehouse_push";
    private static final String PREF_TOKEN = "token";
    private static final String PREF_INSTALLATION = "installationId";
    private static final String PREF_UPDATE_CHECKED_AT = "androidUpdateCheckedAt";
    private static final String PREF_PENDING_UPDATE_VERSION = "androidPendingUpdateVersion";
    private static final String PREF_UPDATE_SNOOZED_VERSION = "androidUpdateSnoozedVersion";
    private static final String PREF_UPDATE_SNOOZED_UNTIL = "androidUpdateSnoozedUntil";
    private static final long UPDATE_CHECK_INTERVAL_MS = 6L * 60L * 60L * 1000L;
    private static final long UPDATE_SNOOZE_MS = 12L * 60L * 60L * 1000L;
    private static final int GOOGLE_SIGN_IN_REQUEST = 1002;
    private static final int FILE_CHOOSER_REQUEST = 1003;
    private static final String GOOGLE_WEB_CLIENT_ID = "329606730319-bqe5c2lkngq4jk87atifp6n9qnn3chfh.apps.googleusercontent.com";

    private WebView webView;
    private View networkErrorView;
    private String lastPageUrl = SITE_URL;
    private final OfflineRecovery offlineRecovery = new OfflineRecovery();
    private TextView networkErrorDetail;
    private Button networkRetryButton;
    private static final long OFFLINE_RETRY_MS = 5000L;
    private static final long PAGE_LOAD_TIMEOUT_MS = 20000L;
    private final Runnable offlineRetry = () -> {
        if (this.activityResumed && offlineRecovery.isOffline()) retryMainPage();
    };
    private final Runnable offlineLoadTimeout = () -> {
        if (webView == null || isFinishing() || isDestroyed()) return;
        offlineRecovery.pageFailed();
        webView.stopLoading();
        showNetworkError();
    };
    private String pendingNotificationLink = "";
    private GoogleSignInClient googleSignInClient;
    private ValueCallback<Uri[]> filePathCallback;
    private final ExecutorService shareExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService updateExecutor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable periodicAppUpdateCheck = new Runnable() {
        @Override public void run() {
            checkForAppUpdateIfDue();
            mainHandler.postDelayed(this, UPDATE_CHECK_INTERVAL_MS);
        }
    };
    private volatile boolean updateCheckInProgress;
    private boolean updateDialogVisible;
    private androidx.appcompat.app.AlertDialog updateProgressDialog;
    private boolean activityResumed;
    private boolean installPermissionSettingsOpened;
    private volatile boolean forceUpdateCheckRequested;
    private File downloadedUpdateFile;
    private String downloadedUpdateVersion = "";

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

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        webView.setBackgroundColor(android.graphics.Color.rgb(17, 19, 21));
        root.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        ));
        networkErrorView = createNetworkErrorView();
        FrameLayout.LayoutParams errorParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        );
        root.addView(networkErrorView, errorParams);

        setContentView(root);
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

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (url == null || !url.startsWith(SITE_URL)) return;
                lastPageUrl = withoutRetryParameter(url);
                offlineRecovery.pageStarted();
                mainHandler.removeCallbacks(offlineLoadTimeout);
                mainHandler.postDelayed(offlineLoadTimeout, PAGE_LOAD_TIMEOUT_MS);
                // Keep the recovery screen visible until a real page succeeds.
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (url == null || !url.startsWith(SITE_URL) || !url.equals(view.getUrl())) return;
                if (!offlineRecovery.pageFinished()) return;
                mainHandler.removeCallbacks(offlineLoadTimeout);
                mainHandler.removeCallbacks(offlineRetry);
                if (networkErrorView != null) networkErrorView.setVisibility(View.GONE);
                if (networkRetryButton != null) networkRetryButton.setEnabled(true);
                // The app removes its startup overlay after Firebase auth resolves.
                // Repaint again after that transition; the first WebView frame alone
                // can be blank on some Android GPU/WebView combinations until touch.
                requestWebViewRedraw();
                view.postDelayed(MainActivity.this::requestWebViewRedraw, 250);
                view.postDelayed(MainActivity.this::requestWebViewRedraw, 700);
                view.postDelayed(MainActivity.this::dispatchPendingNotificationLink, 300);
            }

            @Override
            public void onReceivedError(WebView view, android.webkit.WebResourceRequest request,
                    android.webkit.WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (isCurrentMainFrame(view, request)) showNetworkError();
            }

            @Override
            public void onReceivedHttpError(WebView view, android.webkit.WebResourceRequest request,
                    android.webkit.WebResourceResponse errorResponse) {
                super.onReceivedHttpError(view, request, errorResponse);
                if (isCurrentMainFrame(view, request) && errorResponse.getStatusCode() >= 400) showNetworkError();
            }
        });
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
        if (!restoredWebView) {
            lastPageUrl = notificationUrlFrom(getIntent());
            webView.loadUrl(lastPageUrl);
        } else if (webView.getUrl() != null) {
            lastPageUrl = webView.getUrl();
        }
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

    private View createNetworkErrorView() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        int padding = (int) (28 * getResources().getDisplayMetrics().density);
        panel.setPadding(padding, padding, padding, padding);
        panel.setBackgroundColor(Color.rgb(17, 19, 21));
        panel.setVisibility(View.GONE);

        TextView title = new TextView(this);
        title.setText("Нет соединения с приложением");
        title.setTextColor(Color.WHITE);
        title.setTextSize(20);
        title.setGravity(Gravity.CENTER);
        panel.addView(title, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        TextView detail = new TextView(this);
        networkErrorDetail = detail;
        detail.setText("Проверьте интернет. Заказы и уведомления обновятся после подключения.");
        detail.setTextColor(Color.rgb(174, 188, 188));
        detail.setTextSize(14);
        detail.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams detailParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        detailParams.topMargin = (int) (12 * getResources().getDisplayMetrics().density);
        panel.addView(detail, detailParams);

        Button retry = new Button(this);
        networkRetryButton = retry;
        retry.setText("Переподключиться");
        retry.setAllCaps(false);
        retry.setOnClickListener(view -> retryMainPage());
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        buttonParams.topMargin = (int) (20 * getResources().getDisplayMetrics().density);
        panel.addView(retry, buttonParams);
        return panel;
    }

    private boolean isCurrentMainFrame(WebView view, android.webkit.WebResourceRequest request) {
        return request.isForMainFrame() && (view.getUrl() == null || request.getUrl().toString().equals(view.getUrl()));
    }

    private void scheduleOfflineRetry() {
        mainHandler.removeCallbacks(offlineRetry);
        if (activityResumed && offlineRecovery.isOffline()) mainHandler.postDelayed(offlineRetry, OFFLINE_RETRY_MS);
    }

    private void showNetworkError() {
        runOnUiThread(() -> {
            offlineRecovery.pageFailed();
            mainHandler.removeCallbacks(offlineLoadTimeout);
            if (networkErrorView != null) networkErrorView.setVisibility(View.VISIBLE);
            if (networkRetryButton != null) networkRetryButton.setEnabled(true);
            if (networkErrorDetail != null) networkErrorDetail.setText("Проверьте интернет. Переподключаемся автоматически каждые 5 секунд. Сохранённый вход останется.");
            scheduleOfflineRetry();
        });
    }

    private String withoutRetryParameter(String target) {
        Uri uri = Uri.parse(target);
        Uri.Builder builder = uri.buildUpon().clearQuery();
        for (String key : uri.getQueryParameterNames()) {
            if (!"_native_retry".equals(key)) for (String value : uri.getQueryParameters(key)) builder.appendQueryParameter(key, value);
        }
        return builder.build().toString();
    }

    private void retryMainPage() {
        if (webView == null || isFinishing() || isDestroyed() || !offlineRecovery.beginRetry()) return;
        mainHandler.removeCallbacks(offlineRetry);
        mainHandler.removeCallbacks(offlineLoadTimeout);
        if (networkRetryButton != null) networkRetryButton.setEnabled(false);
        if (networkErrorDetail != null) networkErrorDetail.setText("Переподключаемся… Приложение откроется здесь, когда связь восстановится.");
        String target = lastPageUrl != null && lastPageUrl.startsWith(SITE_URL) ? withoutRetryParameter(lastPageUrl) : SITE_URL;
        String retryUrl = Uri.parse(target).buildUpon()
            .appendQueryParameter("_native_retry", String.valueOf(System.currentTimeMillis()))
            .build().toString();
        mainHandler.postDelayed(offlineLoadTimeout, PAGE_LOAD_TIMEOUT_MS);
        webView.loadUrl(retryUrl);
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
        pendingNotificationLink = safeUrl;
        webView.post(() -> {
            String currentUrl = webView.getUrl();
            if (currentUrl == null || currentUrl.equals("about:blank")) {
                webView.loadUrl(safeUrl);
                return;
            }
            dispatchPendingNotificationLink();
        });
    }

    private void dispatchPendingNotificationLink() {
        if (webView == null || pendingNotificationLink.isEmpty()) return;
        String link = pendingNotificationLink;
        webView.evaluateJavascript(
            "(function(){return typeof window.handleNativeNotificationLink==='function' && " +
                "window.handleNativeNotificationLink(" + JSONObject.quote(link) + ");})()",
            result -> {
                if ("true".equals(result) && link.equals(pendingNotificationLink)) {
                    pendingNotificationLink = "";
                }
            }
        );
    }

    @Override
    protected void onResume() {
        super.onResume();
        activityResumed = true;
        mainHandler.removeCallbacks(periodicAppUpdateCheck);
        mainHandler.postDelayed(periodicAppUpdateCheck, UPDATE_CHECK_INTERVAL_MS);
        sendCachedTokenToSite();
        requestNativePushToken();
        showPendingAppUpdateIfReady();
        checkForAppUpdateIfDue();
        if (webView != null) {
            refreshWebViewAfterResume();
            webView.postDelayed(this::requestWebViewRedraw, 500);
            webView.postDelayed(() -> {
                if (networkErrorView != null && networkErrorView.getVisibility() == View.VISIBLE) {
                    retryMainPage();
                    return;
                }
                webView.evaluateJavascript(
                    "window.checkWarehouseSiteUpdate && window.checkWarehouseSiteUpdate()",
                    null
                );
            }, 500);
        }
    }

    private void refreshWebViewAfterResume() {
        WebView target = webView;
        if (target == null) return;
        target.onResume();
        target.resumeTimers();
        // Reattach the WebView's compositor layer for one frame. On some devices
        // invalidate() alone leaves the previous Surface blank until a touch event.
        target.setVisibility(View.INVISIBLE);
        target.postOnAnimation(() -> {
            if (webView != target || !target.isAttachedToWindow()) return;
            target.setVisibility(View.VISIBLE);
            requestWebViewRedraw();
            target.evaluateJavascript(
                "window.dispatchEvent(new Event('warehouse-app-resumed')); window.dispatchEvent(new Event('resize'))",
                null
            );
            if (Build.VERSION.SDK_INT >= 23) {
                target.postVisualStateCallback(android.os.SystemClock.uptimeMillis(),
                    new WebView.VisualStateCallback() {
                        @Override
                        public void onComplete(long requestId) {
                            requestWebViewRedraw();
                        }
                    });
            }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) requestWebViewRedraw();
    }

    private void requestWebViewRedraw() {
        WebView target = webView;
        if (target == null) return;
        target.post(() -> {
            if (!target.isAttachedToWindow()) return;
            target.onResume();
            target.requestLayout();
            target.invalidate();
            View root = target.getRootView();
            if (root != null) {
                root.requestLayout();
                root.invalidate();
            }
            if (Build.VERSION.SDK_INT >= 16) {
                target.postInvalidateOnAnimation();
                if (root != null) root.postInvalidateOnAnimation();
            }
        });
    }

    @Override
    protected void onPause() {
        activityResumed = false;
        mainHandler.removeCallbacks(offlineRetry);
        mainHandler.removeCallbacks(periodicAppUpdateCheck);
        super.onPause();
    }

    private void forceCheckForAppUpdate() {
        if (downloadedUpdateFile != null && downloadedUpdateFile.exists()) { showPendingAppUpdateIfReady(); return; }
        if (updateCheckInProgress) {
            // A periodic background check may already be running. Treat the user's
            // tap as a manual request so its eventual result is still displayed.
            forceUpdateCheckRequested = true;
            if (updateProgressDialog == null || !updateProgressDialog.isShowing()) showUpdateCheckingDialog();
            return;
        }
        forceUpdateCheckRequested = true;
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putLong(PREF_UPDATE_CHECKED_AT, 0L).apply();
        showUpdateCheckingDialog();
        checkForAppUpdateIfDue();
    }
    private void showUpdateCheckingDialog() {
        if (isFinishing() || isDestroyed() || (updateProgressDialog != null && updateProgressDialog.isShowing())) return;
        android.widget.LinearLayout layout = new android.widget.LinearLayout(this);
        layout.setGravity(android.view.Gravity.CENTER_VERTICAL);
        int pad = (int)(24 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad / 2, pad, pad / 2);
        android.widget.ProgressBar spinner = new android.widget.ProgressBar(this);
        layout.addView(spinner, new android.widget.LinearLayout.LayoutParams(pad, pad));
        android.widget.TextView text = new android.widget.TextView(this);
        text.setText("Связываюсь с GitHub и проверяю последнюю опубликованную версию…");
        text.setTextSize(14); text.setPadding(pad, 0, 0, 0);
        layout.addView(text, new android.widget.LinearLayout.LayoutParams(0, -2, 1));
        updateProgressDialog = new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Проверка обновлений").setView(layout).setCancelable(false).create();
        updateProgressDialog.show();
    }
    private void finishUpdateCheckingDialog(String title, String message) {
        // Capture the manual-check state before posting to the UI thread.
        // The worker's finally block resets forceUpdateCheckRequested immediately;
        // reading the field inside the posted Runnable used to hide the result dialog.
        final boolean showResult = forceUpdateCheckRequested;
        mainHandler.post(() -> {
            if (updateProgressDialog != null && updateProgressDialog.isShowing()) updateProgressDialog.dismiss();
            updateProgressDialog = null;
            if (showResult && !isFinishing() && !isDestroyed()) {
                new androidx.appcompat.app.AlertDialog.Builder(this).setTitle(title).setMessage(message)
                    .setPositiveButton("Понятно", null).show();
            }
        });
    }

    private void checkForAppUpdateIfDue() {
        if (updateCheckInProgress) return;
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        long lastCheck = prefs.getLong(PREF_UPDATE_CHECKED_AT, 0L);
        long now = System.currentTimeMillis();
        if (now - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
        updateCheckInProgress = true;
        prefs.edit().putLong(PREF_UPDATE_CHECKED_AT, now).apply();
        updateExecutor.execute(() -> {
            try {
                AndroidRelease release = findLatestAndroidRelease();
                if (release == null || release.versionCode <= installedAppVersionCode()) {
                    finishUpdateCheckingDialog("Обновлений нет",
                        "У тебя уже установлена последняя версия приложения (v" + installedAppVersionCode() + ").");
                    return;
                }
                File apk = new File(appUpdateDirectory(), "warehouse-orders-update.apk");
                File parent = apk.getParentFile();
                if (parent == null || (!parent.exists() && !parent.mkdirs())) {
                    throw new IllegalStateException("Не удалось подготовить папку для обновления.");
                }
                if (apk.exists() && apk.length() > 0 && hasExpectedApkVersion(apk, release.versionCode)) {
                    markUpdateReady(apk, release.versionName);
                    return;
                }
                File temporaryApk = new File(parent, "warehouse-orders-update.apk.part");
                downloadApk(release.downloadUrl, temporaryApk);
                if (!hasExpectedApkVersion(temporaryApk, release.versionCode)) {
                    throw new IllegalStateException("Скачанный APK не прошёл проверку версии приложения.");
                }
                if (apk.exists() && !apk.delete()) throw new IllegalStateException("Не удалось заменить старый файл обновления.");
                if (!temporaryApk.renameTo(apk)) throw new IllegalStateException("Не удалось сохранить APK обновления.");
                markUpdateReady(apk, release.versionName);
            } catch (Exception error) {
                android.util.Log.w("WarehouseOrders", "Android app update check failed", error);
                finishUpdateCheckingDialog("Не удалось проверить обновления",
                    String.valueOf(error.getMessage() == null ? "Неизвестная ошибка сети." : error.getMessage()));
                getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putLong(PREF_UPDATE_CHECKED_AT, System.currentTimeMillis() - UPDATE_CHECK_INTERVAL_MS + 10L * 60L * 1000L)
                    .apply();
                new File(appUpdateDirectory(), "warehouse-orders-update.apk.part").delete();
            } finally {
                mainHandler.post(() -> {
                    if (updateProgressDialog != null && updateProgressDialog.isShowing()) updateProgressDialog.dismiss();
                    updateProgressDialog = null;
                });
                forceUpdateCheckRequested = false;
                updateCheckInProgress = false;
            }
        });
    }

    private File appUpdateDirectory() {
        File directory = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        return directory == null ? getCacheDir() : directory;
    }

    private AndroidRelease findLatestAndroidRelease() throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(ANDROID_RELEASES_URL).openConnection();
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(20000);
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        connection.setRequestProperty("User-Agent", "WarehouseOrders-Android-Updater");
        try {
            int responseCode = connection.getResponseCode();
            if (responseCode != HttpURLConnection.HTTP_OK) {
                if (responseCode == 403) throw new IllegalStateException("GitHub ограничил частоту запросов (HTTP 403). Попробуй через несколько минут.");
                if (responseCode == 404) throw new IllegalStateException("GitHub не нашёл опубликованный Android-релиз (HTTP 404).");
                throw new IllegalStateException("GitHub вернул HTTP " + responseCode + ".");
            }
            StringBuilder body = new StringBuilder();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) body.append(new String(buffer, 0, count, "UTF-8"));
            }
            // Android and Windows publish into the same repository. The latest
            // GitHub release can be a Windows installer, so select the newest APK.
            JSONArray releases = new JSONArray(body.toString());
            AndroidRelease latest = null;
            for (int releaseIndex = 0; releaseIndex < releases.length(); releaseIndex++) {
                JSONObject release = releases.optJSONObject(releaseIndex);
                if (release == null || release.optBoolean("draft") || release.optBoolean("prerelease")) continue;
                String tag = release.optString("tag_name", "");
                String prefix = "android-v1.0.";
                if (!tag.startsWith(prefix)) continue;
                int versionCode;
                try { versionCode = Integer.parseInt(tag.substring(prefix.length())); }
                catch (NumberFormatException ignored) { continue; }
                JSONArray assets = release.optJSONArray("assets");
                if (assets == null) continue;
                String downloadUrl = "";
                for (int assetIndex = 0; assetIndex < assets.length(); assetIndex++) {
                    JSONObject asset = assets.optJSONObject(assetIndex);
                    if (asset != null && "app-release.apk".equals(asset.optString("name"))) {
                        downloadUrl = asset.optString("browser_download_url", ""); break;
                    }
                }
                if (!downloadUrl.startsWith("https://github.com/Hlebish/warehouse_orders/releases/download/")) continue;
                if (latest == null || versionCode > latest.versionCode) latest = new AndroidRelease(versionCode, "1.0." + versionCode, downloadUrl);
            }
            return latest;
        } finally {
            connection.disconnect();
        }
    }

    private void downloadApk(String downloadUrl, File destination) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(downloadUrl).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(45000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "WarehouseOrders-Android-Updater");
        try {
            int responseCode = connection.getResponseCode();
            if (responseCode != HttpURLConnection.HTTP_OK) throw new IllegalStateException("Не удалось скачать APK (HTTP " + responseCode + ").");
            long length = connection.getContentLength();
            if (length > 180L * 1024L * 1024L) throw new IllegalStateException("Файл обновления превышает допустимый размер.");
            try (InputStream input = connection.getInputStream(); OutputStream output = new FileOutputStream(destination)) {
                byte[] buffer = new byte[32768];
                int count;
                long total = 0;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > 180L * 1024L * 1024L) throw new IllegalStateException("Файл обновления превышает допустимый размер.");
                    output.write(buffer, 0, count);
                }
                output.flush();
            }
        } finally {
            connection.disconnect();
        }
    }

    private boolean hasExpectedApkVersion(File apk, int expectedVersionCode) {
        long apkVersion = getApkVersionCode(apk);
        return apkVersion == expectedVersionCode && apkVersion > installedAppVersionCode();
    }

    private long installedAppVersionCode() {
        try {
            android.content.pm.PackageInfo installed = getPackageManager().getPackageInfo(getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? installed.getLongVersionCode() : installed.versionCode;
        } catch (Exception error) {
            android.util.Log.w("WarehouseOrders", "Could not read installed app version", error);
            return 0;
        }
    }

    private long getApkVersionCode(File apk) {
        if (apk == null || !apk.isFile() || apk.length() == 0) return -1;
        try {
            android.content.pm.PackageInfo info = getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), 0);
            if (info == null || !getPackageName().equals(info.packageName)) return -1;
            return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
        } catch (Exception error) {
            android.util.Log.w("WarehouseOrders", "Could not validate downloaded APK", error);
            return -1;
        }
    }

    private void markUpdateReady(File apk, String versionName) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(PREF_PENDING_UPDATE_VERSION, versionName).apply();
        mainHandler.post(() -> {
            downloadedUpdateFile = apk;
            downloadedUpdateVersion = versionName;
            showPendingAppUpdateIfReady();
        });
    }

    private void showPendingAppUpdateIfReady() {
        if (downloadedUpdateFile == null) {
            File apk = new File(appUpdateDirectory(), "warehouse-orders-update.apk");
            if (apk.exists() && apk.length() > 0) {
                long versionCode = getApkVersionCode(apk);
                if (versionCode <= installedAppVersionCode()) {
                    apk.delete();
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(PREF_PENDING_UPDATE_VERSION).apply();
                    return;
                }
                downloadedUpdateFile = apk;
                downloadedUpdateVersion = getSharedPreferences(PREFS, MODE_PRIVATE)
                    .getString(PREF_PENDING_UPDATE_VERSION, "1.0." + versionCode);
            }
        }
        if (updateDialogVisible || !activityResumed || downloadedUpdateFile == null || !downloadedUpdateFile.exists() || isFinishing() || isDestroyed()) return;
        if (installPermissionSettingsOpened) {
            installPermissionSettingsOpened = false;
            if (Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls()) {
                launchPackageInstaller();
                return;
            }
        }
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (downloadedUpdateVersion.equals(prefs.getString(PREF_UPDATE_SNOOZED_VERSION, "")) &&
                System.currentTimeMillis() < prefs.getLong(PREF_UPDATE_SNOOZED_UNTIL, 0L)) return;
        updateDialogVisible = true;
        new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Обновление приложения готово")
            .setMessage("Версия " + downloadedUpdateVersion + " уже скачана. Установить её сейчас?")
            .setCancelable(true)
            .setPositiveButton("Установить", (dialog, which) -> installDownloadedUpdate())
            .setNegativeButton("Позже", (dialog, which) -> prefs.edit()
                .putString(PREF_UPDATE_SNOOZED_VERSION, downloadedUpdateVersion)
                .putLong(PREF_UPDATE_SNOOZED_UNTIL, System.currentTimeMillis() + UPDATE_SNOOZE_MS)
                .apply())
            .setOnDismissListener(dialog -> updateDialogVisible = false)
            .show();
    }

    private void installDownloadedUpdate() {
        if (downloadedUpdateFile == null || !downloadedUpdateFile.exists()) {
            updateDialogVisible = false;
            return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            installPermissionSettingsOpened = true;
            new androidx.appcompat.app.AlertDialog.Builder(this)
                .setTitle("Разрешите обновление")
                .setMessage("Android просит один раз разрешить этому приложению устанавливать обновления. После этого вернитесь сюда — установка продолжится.")
                .setNegativeButton("Отмена", (dialog, which) -> { })
                .setPositiveButton("Открыть настройки", (dialog, which) -> {
                    Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName()));
                    try { startActivity(settingsIntent); }
                    catch (Exception error) {
                        installPermissionSettingsOpened = false;
                        android.util.Log.w("WarehouseOrders", "Could not open install permission settings", error);
                    }
                })
                .show();
            return;
        }
        launchPackageInstaller();
    }

    private void launchPackageInstaller() {
        try {
            Uri apkUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", downloadedUpdateFile);
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(installIntent);
        } catch (Exception error) {
            android.util.Log.e("WarehouseOrders", "Could not start APK installer", error);
            new androidx.appcompat.app.AlertDialog.Builder(this)
                .setTitle("Не удалось открыть установщик")
                .setMessage("APK уже скачан. Проверьте разрешение на установку приложений для «Заказы · Склад» и попробуйте снова.")
                .setPositiveButton("Понятно", null)
                .show();
        }
    }

    private static final class AndroidRelease {
        final int versionCode;
        final String versionName;
        final String downloadUrl;
        AndroidRelease(int versionCode, String versionName, String downloadUrl) {
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.downloadUrl = downloadUrl;
        }
    }

    private File downloadPhotoFile(String imageUrl) throws Exception {
        String contentType;
        InputStream photoInput;
        HttpURLConnection connection = null;
        if (imageUrl.startsWith("data:image/")) {
            if (imageUrl.length() > 28 * 1024 * 1024) throw new IllegalStateException("Photo is larger than 20 MB");
            int comma = imageUrl.indexOf(',');
            if (comma < 0) throw new IllegalArgumentException("Invalid inline photo");
            String metadata = imageUrl.substring(5, comma).toLowerCase(java.util.Locale.ROOT);
            if (!(metadata.equals("image/jpeg;base64") || metadata.equals("image/png;base64") ||
                  metadata.equals("image/webp;base64"))) throw new IllegalArgumentException("Unsupported inline photo type");
            byte[] bytes = android.util.Base64.decode(imageUrl.substring(comma + 1), android.util.Base64.DEFAULT);
            if (bytes.length > 20 * 1024 * 1024) throw new IllegalStateException("Photo is larger than 20 MB");
            contentType = metadata.substring(0, metadata.indexOf(';'));
            photoInput = new ByteArrayInputStream(bytes);
        } else {
            URL url = new URL(imageUrl);
            String host = url.getHost();
            if (!"https".equalsIgnoreCase(url.getProtocol()) ||
                    !("firebasestorage.googleapis.com".equalsIgnoreCase(host) ||
                      "storage.googleapis.com".equalsIgnoreCase(host))) throw new IllegalArgumentException("Unsupported photo URL");
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(true);
            connection.connect();
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("Photo download failed: " + status);
            contentType = connection.getContentType();
            if (contentType == null || !contentType.toLowerCase(java.util.Locale.ROOT).startsWith("image/"))
                throw new IllegalStateException("The link does not point to an image");
            if (connection.getContentLength() > 20 * 1024 * 1024) throw new IllegalStateException("Photo is larger than 20 MB");
            photoInput = connection.getInputStream();
        }
        String extension = contentType.equalsIgnoreCase("image/png") ? ".png" :
                contentType.equalsIgnoreCase("image/webp") ? ".webp" : ".jpg";
        File imageFile = File.createTempFile("warehouse-viber-", extension, getCacheDir());
        try (InputStream input = photoInput; FileOutputStream output = new FileOutputStream(imageFile)) {
            byte[] buffer = new byte[8192];
            int total = 0, count;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > 20 * 1024 * 1024) throw new IllegalStateException("Photo is larger than 20 MB");
                output.write(buffer, 0, count);
            }
        } finally {
            if (connection != null) connection.disconnect();
        }
        return imageFile;
    }

    private void downloadAndSharePhoto(String imageUrl, String caption) {
        downloadAndSharePhotos(Collections.singletonList(imageUrl), caption);
    }

    private void downloadAndSharePhotos(List<String> imageUrls, String caption) {
        try {
            if (imageUrls == null || imageUrls.isEmpty() || imageUrls.size() > 20)
                throw new IllegalArgumentException("Choose between 1 and 20 photos");
            ArrayList<Uri> contentUris = new ArrayList<>();
            long totalBytes = 0;
            for (String imageUrl : imageUrls) {
                File imageFile = downloadPhotoFile(imageUrl);
                totalBytes += imageFile.length();
                if (totalBytes > 100L * 1024 * 1024) throw new IllegalStateException("Photos are larger than 100 MB in total");
                contentUris.add(FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", imageFile));
            }
            Intent send = new Intent(contentUris.size() == 1 ? Intent.ACTION_SEND : Intent.ACTION_SEND_MULTIPLE);
            send.setType("image/*");
            if (contentUris.size() == 1) {
                send.putExtra(Intent.EXTRA_STREAM, contentUris.get(0));
            } else {
                send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, contentUris);
            }
            if (contentUris.size() == 1) send.putExtra(Intent.EXTRA_TEXT, caption == null ? "Фото дефекта" : caption);
            ClipData clipData = ClipData.newUri(getContentResolver(), "Фото дефекта", contentUris.get(0));
            for (int i = 1; i < contentUris.size(); i++) clipData.addItem(new ClipData.Item(contentUris.get(i)));
            send.setClipData(clipData);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            send.setPackage("com.viber.voip");
            Intent launch = send;
            if (send.resolveActivity(getPackageManager()) == null) launch = Intent.createChooser(send.setPackage(null), "Отправить фотографии");
            final Intent finalLaunch = launch;
            runOnUiThread(() -> {
                try {
                    startActivity(finalLaunch);
                    if (contentUris.size() > 1) android.widget.Toast.makeText(this,
                        "Выбери чат в Viber и нажми «Отправить»", android.widget.Toast.LENGTH_LONG).show();
                }
                catch (Exception error) { android.widget.Toast.makeText(this, "Не удалось открыть отправку фото в Viber", android.widget.Toast.LENGTH_LONG).show(); }
            });
        } catch (Exception error) {
            android.util.Log.e("WarehouseOrders", "Unable to share photos to Viber", error);
            runOnUiThread(() -> android.widget.Toast.makeText(this,
                "Не удалось подготовить фотографии для Viber", android.widget.Toast.LENGTH_LONG).show());
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
        public void checkForAppUpdate() {
            runOnUiThread(() -> forceCheckForAppUpdate());
        }

        @JavascriptInterface
        public void invalidateWebView() {
            runOnUiThread(() -> {
                if (webView == null || !webView.isAttachedToWindow()) return;
                webView.requestLayout();
                webView.invalidate();
                if (Build.VERSION.SDK_INT >= 16) webView.postInvalidateOnAnimation();
                webView.postDelayed(() -> {
                    if (webView != null && webView.isAttachedToWindow() && Build.VERSION.SDK_INT >= 16) {
                        webView.postInvalidateOnAnimation();
                    }
                }, 180);
            });
        }

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

        @JavascriptInterface
        public void sharePhotosToViber(String imageUrlsJson, String caption) {
            if (imageUrlsJson == null || imageUrlsJson.isEmpty()) return;
            shareExecutor.execute(() -> {
                try {
                    JSONArray urls = new JSONArray(imageUrlsJson);
                    ArrayList<String> values = new ArrayList<>();
                    for (int i = 0; i < urls.length(); i++) values.add(urls.getString(i));
                    downloadAndSharePhotos(values, caption);
                } catch (Exception error) {
                    android.util.Log.e("WarehouseOrders", "Invalid group of photos", error);
                    runOnUiThread(() -> android.widget.Toast.makeText(MainActivity.this,
                        "Не удалось прочитать список фотографий", android.widget.Toast.LENGTH_LONG).show());
                }
            });
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
        mainHandler.removeCallbacks(offlineRetry);
        mainHandler.removeCallbacks(offlineLoadTimeout);
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
