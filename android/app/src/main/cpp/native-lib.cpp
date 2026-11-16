// Starts the embedded Node runtime (nodejs-mobile) and sends its output to logcat.
#include <jni.h>
#include <android/log.h>
#include <pthread.h>
#include <unistd.h>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "node.h"

static int pipe_stdout[2];
static int pipe_stderr[2];
static const char *TAG = "repronote-node";

static void *log_pipe(void *arg) {
    int fd = *static_cast<int *>(arg);
    int priority = fd == pipe_stderr[0] ? ANDROID_LOG_ERROR : ANDROID_LOG_INFO;
    char buf[2048];
    ssize_t n;
    while ((n = read(fd, buf, sizeof buf - 1)) > 0) {
        if (buf[n - 1] == '\n') --n;
        buf[n] = 0;
        __android_log_write(priority, TAG, buf);
    }
    return nullptr;
}

static void redirect_output() {
    setvbuf(stdout, nullptr, _IOLBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    pipe(pipe_stdout);
    pipe(pipe_stderr);
    dup2(pipe_stdout[1], STDOUT_FILENO);
    dup2(pipe_stderr[1], STDERR_FILENO);
    pthread_t t1, t2;
    pthread_create(&t1, nullptr, log_pipe, &pipe_stdout[0]);
    pthread_create(&t2, nullptr, log_pipe, &pipe_stderr[0]);
    pthread_detach(t1);
    pthread_detach(t2);
}

extern "C" JNIEXPORT jint JNICALL
Java_io_github_ancarsenat_repronote_NodeRunner_startNode(JNIEnv *env, jclass, jobjectArray arguments) {
    jsize count = env->GetArrayLength(arguments);
    // node::Start wants the arguments in one contiguous block.
    std::vector<std::string> args;
    size_t total = 0;
    for (jsize i = 0; i < count; i++) {
        auto s = (jstring) env->GetObjectArrayElement(arguments, i);
        const char *chars = env->GetStringUTFChars(s, nullptr);
        args.emplace_back(chars);
        total += strlen(chars) + 1;
        env->ReleaseStringUTFChars(s, chars);
    }
    char *block = (char *) calloc(total, 1);
    std::vector<char *> argv;
    char *p = block;
    for (auto &a : args) {
        strcpy(p, a.c_str());
        argv.push_back(p);
        p += a.size() + 1;
    }
    redirect_output();
    return node::Start((int) argv.size(), argv.data());
}
