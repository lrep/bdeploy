package io.bdeploy.ui.dto;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;

import io.bdeploy.interfaces.manifest.state.InstanceOverallStateRecord;
import io.bdeploy.interfaces.manifest.state.InstanceOverallStateRecord.OverallStatus;

public class InstanceOverallStatusDto {

    @JsonAlias("uuid")
    public String id;

    /**
     * @deprecated Compat with 4.x
     */
    @Deprecated(forRemoval = true)
    @JsonProperty("uuid")
    public String getUuid() {
        return id;
    }

    public OverallStatus status;
    public long timestamp;
    public List<String> messages;

    public InstanceOverallStatusDto(String id, InstanceOverallStateRecord rec) {
        this.id = id;
        this.status = rec.status;
        this.timestamp = rec.timestamp;
        this.messages = rec.messages;
    }

}
