package io.bdeploy.interfaces.manifest.history.runtime;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;

import io.bdeploy.interfaces.configuration.pcu.ProcessState;

public class MinionRuntimeHistoryRecord {

    public String PID;
    public ProcessState state;
    public long timestamp;

    @JsonCreator
    public MinionRuntimeHistoryRecord(@JsonProperty("PID") String processId, @JsonProperty("state") ProcessState state,
            @JsonProperty("timestamp") long timestamp) {
        this.state = state;
        this.timestamp = timestamp;
        this.PID = processId;
    }
}
