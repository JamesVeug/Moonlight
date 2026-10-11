FROM docker.io/library/maven:3.9-eclipse-temurin-17
WORKDIR /app/Server
COPY Server/pom.xml ./pom.xml
RUN mvn -B dependency:go-offline
COPY Server/ ./
RUN mvn -B clean package && chmod +x docker-entrypoint.sh
ENTRYPOINT ["/app/Server/docker-entrypoint.sh"]
