#pragma once

#include <QQuickFramebufferObject>
#include <QtQml/qqmlregistration.h>

struct pv_player;

// A QML item that shows the core's video player. libmpv draws each frame
// into this item's framebuffer on Qt's render thread.
class VideoItem : public QQuickFramebufferObject
{
    Q_OBJECT
    QML_ELEMENT
    // A MediaFolder path id; empty stops playback.
    Q_PROPERTY(QString source READ source WRITE setSource NOTIFY sourceChanged)
    Q_PROPERTY(bool paused READ paused WRITE setPaused NOTIFY pausedChanged)

public:
    explicit VideoItem(QQuickItem *parent = nullptr);
    ~VideoItem() override;

    Renderer *createRenderer() const override;

    QString source() const { return m_source; }
    void setSource(const QString &source);
    bool paused() const { return m_paused; }
    void setPaused(bool paused);

    // Read by the renderer only while the GUI thread is blocked in sync.
    pv_player *player() const { return m_player; }

signals:
    void sourceChanged();
    void pausedChanged();

private:
    pv_player *m_player = nullptr;
    QString m_source;
    bool m_paused = false;
};
