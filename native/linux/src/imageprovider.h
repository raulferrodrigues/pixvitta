#pragma once

#include <QQuickImageProvider>

// Serves `image://pixvitta/<path id>` from the core's decoder. QML loads it
// off the main thread when the Image is asynchronous.
class ImageProvider : public QQuickImageProvider
{
public:
    ImageProvider();

    QImage requestImage(const QString &id, QSize *size, const QSize &requestedSize) override;
};
