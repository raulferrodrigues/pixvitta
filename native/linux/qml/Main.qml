import QtQuick
import Pixvitta

Window {
    id: window

    required property MediaFolder folder

    width: 1280
    height: 800
    visible: true
    color: "black"
    title: folder.count > 0 ? folder.name + " - Pixvitta" : "Pixvitta"

    ImageItem {
        id: image
        anchors.fill: parent
        visible: !window.folder.isVideo
        source: window.folder.count > 0 && !window.folder.isVideo ? window.folder.pathId : ""

        // Ctrl and the wheel zoom at the pointer. Once zoomed in, the wheel
        // and dragging pan, as in the Electron app.
        MouseArea {
            property point last

            anchors.fill: parent
            cursorShape: image.zoomed ? (pressed ? Qt.ClosedHandCursor : Qt.OpenHandCursor) : Qt.ArrowCursor

            onWheel: (wheel) => {
                const touchpad = wheel.pixelDelta.x !== 0 || wheel.pixelDelta.y !== 0
                let delta = touchpad ? wheel.pixelDelta : wheel.angleDelta
                if (wheel.modifiers & Qt.ControlModifier) {
                    image.wheelZoom(delta.y, wheel.x, wheel.y)
                } else if (image.zoomed) {
                    // Shift turns a plain wheel sideways.
                    if (delta.x === 0 && (wheel.modifiers & Qt.ShiftModifier))
                        delta = Qt.point(delta.y, 0)
                    image.panBy(delta.x, delta.y)
                } else {
                    wheel.accepted = false
                }
            }
            onPressed: (mouse) => {
                mouse.accepted = image.zoomed
                last = Qt.point(mouse.x, mouse.y)
            }
            onPositionChanged: (mouse) => {
                image.panBy(mouse.x - last.x, mouse.y - last.y)
                last = Qt.point(mouse.x, mouse.y)
            }
        }
    }

    VideoItem {
        id: video
        anchors.fill: parent
        visible: window.folder.isVideo
        source: window.folder.isVideo ? window.folder.pathId : ""
    }

    Text {
        anchors.centerIn: parent
        visible: window.folder.count === 0
        text: "No images or videos in this folder"
        color: "#aaaaaa"
        font.pixelSize: 18
    }

    Rectangle {
        id: bar
        anchors {
            left: parent.left
            right: parent.right
            bottom: parent.bottom
        }
        height: 44
        color: "#b0000000"
        visible: window.folder.count > 0

        Row {
            anchors.centerIn: parent
            spacing: 24

            BarButton {
                label: "Previous"
                onClicked: window.folder.previous()
            }
            BarButton {
                label: video.paused ? "Play" : "Pause"
                enabled: window.folder.isVideo
                onClicked: video.paused = !video.paused
            }
            BarButton {
                label: "Next"
                onClicked: window.folder.next()
            }
        }

        Text {
            anchors {
                left: parent.left
                leftMargin: 16
                verticalCenter: parent.verticalCenter
            }
            text: (window.folder.index + 1) + " / " + window.folder.count + "   " + window.folder.name
            color: "white"
            font.pixelSize: 14
        }
    }

    component BarButton: Text {
        id: button

        property string label
        signal clicked

        text: label
        color: enabled ? "white" : "#666666"
        font.pixelSize: 15

        // A disabled item also disables this area.
        MouseArea {
            anchors.fill: parent
            anchors.margins: -8
            onClicked: button.clicked()
        }
    }

    Item {
        focus: true
        Keys.onPressed: (event) => {
            // Ctrl alone, on either the main keys or the keypad.
            const zoomKeys = (event.modifiers & ~Qt.KeypadModifier) === Qt.ControlModifier
                && !window.folder.isVideo
            if (event.key === Qt.Key_Right) {
                window.folder.next()
            } else if (event.key === Qt.Key_Left) {
                window.folder.previous()
            } else if (event.key === Qt.Key_Space && window.folder.isVideo) {
                video.paused = !video.paused
            } else if (zoomKeys && (event.key === Qt.Key_Equal || event.key === Qt.Key_Plus)) {
                image.zoomIn()
            } else if (zoomKeys && event.key === Qt.Key_Minus) {
                image.zoomOut()
            } else {
                return
            }
            event.accepted = true
        }
    }
}
