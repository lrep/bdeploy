package io.bdeploy.common.util;

import java.text.SimpleDateFormat;
import java.util.Date;

public class DurationHelper {

    private DurationHelper() {
    }

    public static String formatDuration(long timeInMillis) {
        return new SimpleDateFormat("mm 'min' ss 'sec' SSS 'ms'").format(new Date(timeInMillis));
    }

}
