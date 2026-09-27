-- Tablas del Tutor de estudio para una base de datos en la nube.
-- Aquí NO se crea la base ni el usuario: eso lo hace el panel del proveedor.
-- Ejecutar con:
--   mysql -h HOST -P PUERTO -u USUARIO -p --ssl-mode=REQUIRED NOMBRE_BASE < esquema-nube.sql

CREATE TABLE IF NOT EXISTS usuarios (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  correo             VARCHAR(60)  NOT NULL UNIQUE,
  hash_contrasena    CHAR(60)     NOT NULL,
  verificado         BOOLEAN      NOT NULL DEFAULT FALSE,
  token_verificacion CHAR(48)     NULL,
  assistant_id       VARCHAR(64)  NULL,
  creado_en          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_token (token_verificacion)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS conversaciones (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id  INT          NOT NULL,
  thread_id   VARCHAR(64)  NOT NULL UNIQUE,
  titulo      VARCHAR(100) NOT NULL,
  creado_en   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_conversaciones_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    ON DELETE CASCADE,
  INDEX idx_usuario (usuario_id, creado_en)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS mensajes (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  conversacion_id INT                      NOT NULL,
  rol             ENUM('alumno', 'tutor')  NOT NULL,
  contenido       TEXT                     NOT NULL,
  creado_en       DATETIME                 NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mensajes_conversacion
    FOREIGN KEY (conversacion_id) REFERENCES conversaciones(id)
    ON DELETE CASCADE,
  INDEX idx_conversacion (conversacion_id, id)
) ENGINE=InnoDB;
