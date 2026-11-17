#include "mediafolder.h"

#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQuickWindow>
#include <QSGRendererInterface>

#include <clocale>

int main(int argc, char *argv[])
{
    // libmpv's render API draws with OpenGL, so the scene graph has to as well.
    QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);

    QGuiApplication app(argc, argv);
    QGuiApplication::setApplicationName(QStringLiteral("Pixvitta"));
    // QGuiApplication applies the user's locale; libmpv refuses to start
    // unless numbers are formatted the C way.
    std::setlocale(LC_NUMERIC, "C");

    const QStringList arguments = QGuiApplication::arguments();
    if (arguments.size() != 2) {
        qCritical("Usage: pixvitta <folder>");
        return 2;
    }

    MediaFolder folder;
    if (!folder.open(arguments.at(1)))
        return 1;

    QQmlApplicationEngine engine;
    engine.addImportPath(QStringLiteral("qrc:/qt/qml"));
    engine.setInitialProperties({{QStringLiteral("folder"), QVariant::fromValue(&folder)}});
    engine.load(QUrl(QStringLiteral("qrc:/qt/qml/Pixvitta/qml/Main.qml")));
    if (engine.rootObjects().isEmpty())
        return 1;

    return QGuiApplication::exec();
}
