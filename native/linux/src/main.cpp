#include "mediafolder.h"

#include <QApplication>
#include <QQmlApplicationEngine>
#include <QQuickWindow>
#include <QSGRendererInterface>

#include <clocale>

int main(int argc, char *argv[])
{
    // libmpv's render API draws with OpenGL, so the scene graph has to as well.
    QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);

    // QApplication rather than QGuiApplication for QFileDialog, the folder
    // picker, which uses the desktop's own dialog where Qt has one.
    QApplication app(argc, argv);
    QApplication::setApplicationName(QStringLiteral("Pixvitta"));
    // QApplication applies the user's locale; libmpv refuses to start
    // unless numbers are formatted the C way.
    std::setlocale(LC_NUMERIC, "C");

    const QStringList arguments = QApplication::arguments();
    if (arguments.size() > 2) {
        qCritical("Usage: pixvitta [folder]");
        return 2;
    }

    // Without a folder, the window opens empty and asks for one.
    MediaFolder folder;
    if (arguments.size() == 2 && !folder.open(arguments.at(1)))
        return 1;

    QQmlApplicationEngine engine;
    engine.addImportPath(QStringLiteral("qrc:/qt/qml"));
    engine.setInitialProperties({{QStringLiteral("folder"), QVariant::fromValue(&folder)}});
    engine.load(QUrl(QStringLiteral("qrc:/qt/qml/Pixvitta/qml/Main.qml")));
    if (engine.rootObjects().isEmpty())
        return 1;

    return QApplication::exec();
}
