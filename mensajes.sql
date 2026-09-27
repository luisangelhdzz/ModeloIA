-- Tabla de mensajes del Tutor de estudio
-- Ejecutar con:  mysql -u root -p tutor < mensajes.sql

USE tutor;

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
