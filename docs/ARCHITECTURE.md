# System Architecture

## Overview
Trading Assistant is built as an Electron desktop application with a modular architecture supporting real-time trading platform monitoring and rule enforcement.

## Core Components

### Main Process (`src/main.js`)
- Application lifecycle management
- Screen capture coordination
- IPC message handling
- System integration (notifications, shortcuts)

### Renderer Process (`src/renderer/`)
- User interface components
- Real-time data visualization
- Configuration management

### Trading Engine (`src/trading/`)
- Rule evaluation logic
- Trade detection algorithms
- Risk calculation

### OCR Engine (`src/ocr/`)
- Image preprocessing
- Text recognition
- Platform-specific parsing

### Alert System (`src/alerts/`)
- Intervention popup management
- Timeout enforcement
- User notification handling

## Data Flow

1. **Screen Capture**: Desktop capturer → Image buffer
2. **OCR Processing**: Image → Text extraction → Data parsing
3. **Trade Detection**: Balance changes → Trade identification
4. **Rule Evaluation**: Current state → Rule violations
5. **Intervention**: Violations → User alerts → Timeout enforcement

## Security Considerations

- Local data processing only
- No cloud storage of trading data
- Secure handling of screen capture permissions
- Protection against rule bypassing

## Scalability

- Modular plugin architecture for new trading platforms
- Configurable rule engine
- Extensible alert system
- Cross-platform compatibility layer
