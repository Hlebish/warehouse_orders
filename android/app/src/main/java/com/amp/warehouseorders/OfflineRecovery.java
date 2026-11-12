package com.amp.warehouseorders;

/** Main-thread state shared by automatic and manual WebView recovery. */
final class OfflineRecovery {
    private boolean offline;
    private boolean loading;
    private boolean failed;

    void pageStarted() { loading = true; failed = false; }
    void pageFailed() { offline = true; loading = false; failed = true; }
    boolean pageFinished() {
        if (failed) return false; // WebView also finishes its internal error page.
        offline = false;
        loading = false;
        return true;
    }
    boolean beginRetry() {
        if (!offline || loading) return false;
        loading = true;
        failed = false;
        return true;
    }
    boolean isOffline() { return offline; }
}
