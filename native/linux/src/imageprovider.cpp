#include "imageprovider.h"

#include "mediafolder.h"

#include <pixvitta.h>

ImageProvider::ImageProvider()
    : QQuickImageProvider(QQuickImageProvider::Image)
{
}

QImage ImageProvider::requestImage(const QString &id, QSize *size, const QSize &)
{
    const QByteArray path = MediaFolder::pathFromId(id);
    pv_image *image = nullptr;
    const int status = pv_image_decode(path.constData(), &image);
    if (status != PV_OK) {
        qWarning("Could not open %s: %s", path.constData(), pv_error_string(status));
        return {};
    }
    if (size)
        *size = QSize(int(image->width), int(image->height));
    // No copy: the QImage reads the core's buffer and hands it back to the
    // core once Qt is done with it.
    return QImage(
        image->pixels, int(image->width), int(image->height), qsizetype(image->stride),
        QImage::Format_RGBA8888, [](void *info) { pv_image_release(static_cast<pv_image *>(info)); },
        image);
}
