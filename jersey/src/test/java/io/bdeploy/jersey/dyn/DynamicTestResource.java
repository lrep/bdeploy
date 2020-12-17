package io.bdeploy.jersey.dyn;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;

public interface DynamicTestResource {

    public static class ValueDto {

        public String str;

        @JsonCreator
        public ValueDto(@JsonProperty("str") String s) {
            str = s;
        }
    }

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public ValueDto getValue();

}
