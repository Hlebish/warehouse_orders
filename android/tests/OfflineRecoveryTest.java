package com.amp.warehouseorders;

public final class OfflineRecoveryTest {
    public static void main(String[] args) {
        OfflineRecovery recovery = new OfflineRecovery();
        assert !recovery.beginRetry() : "Healthy app must not reload";
        recovery.pageStarted();
        recovery.pageFailed();
        assert recovery.isOffline();
        assert !recovery.pageFinished() : "Finishing the internal error page is not a recovery";
        assert recovery.beginRetry() : "Manual retry must start";
        assert !recovery.beginRetry() : "Automatic retry must not overlap a manual retry";
        recovery.pageStarted();
        assert recovery.isOffline() : "Starting navigation must keep the recovery screen";
        recovery.pageFailed();
        assert !recovery.pageFinished();
        assert recovery.beginRetry() : "A failed attempt must allow another retry";
        recovery.pageStarted();
        recovery.pageFailed(); // load watchdog timeout
        assert recovery.beginRetry() : "A hung navigation must not disable future retries";
        recovery.pageStarted();
        assert recovery.pageFinished() : "Successful navigation must recover";
        assert !recovery.isOffline();
        assert !recovery.beginRetry() : "Stop retries once the app loads";
        System.out.println("Android recovery: error-page callbacks, manual/automatic retries, timeout and successful recovery passed");
    }
}
