"""Run checks inside an owned process group, including descendants on normal exit."""
import os
import pathlib
import signal
import subprocess
import time

if os.name == "nt":
    import ctypes
    from ctypes import wintypes

    class BasicLimits(ctypes.Structure):
        _fields_ = [("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64),
                    ("flags", wintypes.DWORD), ("min_working", ctypes.c_size_t),
                    ("max_working", ctypes.c_size_t), ("active_limit", wintypes.DWORD),
                    ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD),
                    ("scheduling", wintypes.DWORD)]

    class IoCounters(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in
                    ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]

    class ExtendedLimits(ctypes.Structure):
        _fields_ = [("basic", BasicLimits), ("io", IoCounters),
                    ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
                    ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t)]

    class Accounting(ctypes.Structure):
        _fields_ = [(name, ctypes.c_int64) for name in
                    ("user", "kernel", "period_user", "period_kernel")] + [
                    ("faults", wintypes.DWORD), ("total", wintypes.DWORD),
                    ("active", wintypes.DWORD), ("terminated", wintypes.DWORD)]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.SetInformationJobObject.restype = wintypes.BOOL
    kernel.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p,
                                                 wintypes.DWORD, ctypes.c_void_p]
    kernel.QueryInformationJobObject.restype = wintypes.BOOL
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel.TerminateJobObject.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    native = ctypes.WinDLL("ntdll")
    native.NtResumeProcess.argtypes = [wintypes.HANDLE]
    native.NtResumeProcess.restype = ctypes.c_long


class OwnedGroup:
    def __init__(self):
        self.handle = None
        if os.name == "nt":
            self.handle = kernel.CreateJobObjectW(None, None)
            if not self.handle:
                raise ctypes.WinError(ctypes.get_last_error())
            limits = ExtendedLimits()
            limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if not kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
                self.close()
                raise ctypes.WinError(ctypes.get_last_error())

    def start(self, argv, cwd, env, output):
        process = subprocess.Popen(
            argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=output,
            start_new_session=os.name != "nt",
            creationflags=(subprocess.CREATE_NO_WINDOW | 0x4) if os.name == "nt" else 0)
        if os.name == "nt":
            # Start suspended so no descendant can run before job assignment.
            handle = wintypes.HANDLE(int(process._handle))
            if not kernel.AssignProcessToJobObject(self.handle, handle):
                process.kill()
                process.wait(timeout=5)
                raise ctypes.WinError(ctypes.get_last_error())
            status = native.NtResumeProcess(handle)
            if status != 0:
                kernel.TerminateJobObject(self.handle, 1)
                process.wait(timeout=5)
                raise OSError("NtResumeProcess failed: " + str(status))
        return process

    def active(self, process):
        if os.name == "nt":
            accounting = Accounting()
            if not kernel.QueryInformationJobObject(self.handle, 1, ctypes.byref(accounting),
                                                     ctypes.sizeof(accounting), None):
                raise ctypes.WinError(ctypes.get_last_error())
            return accounting.active > 0
        try:
            os.killpg(process.pid, 0)
            return True
        except ProcessLookupError:
            return False

    def finish(self, process):
        active = self.active(process)
        # Windows may briefly retain an exiting helper in job accounting after
        # the root handle signals. Allow bounded drain, then terminate leftovers.
        deadline = time.monotonic() + 0.25
        while active and process.poll() is not None and time.monotonic() < deadline:
            time.sleep(0.02)
            active = self.active(process)
        if active:
            if os.name == "nt":
                if not kernel.TerminateJobObject(self.handle, 1):
                    return False, active
            else:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            return False, active
        until = time.monotonic() + 3
        while self.active(process):
            if time.monotonic() >= until:
                return False, active
            time.sleep(0.02)
        return True, active

    def close(self):
        if self.handle:
            kernel.CloseHandle(self.handle)
            self.handle = None


def run_owned(argv, repo, env, output, timeout):
    group, process = None, None
    result = {"exit_code": None, "failure_kind": None, "cleanup_confirmed": False}
    try:
        group = OwnedGroup()
        process = group.start(argv, repo, env, output)
        try:
            result["exit_code"] = process.wait(timeout=timeout)
            if result["exit_code"] != 0:
                result["failure_kind"] = "check_failure"
        except subprocess.TimeoutExpired:
            result["failure_kind"] = "timeout"
            output.write(b"\n[controller] timeout; terminating owned process group\n")
    except OSError as error:
        result["failure_kind"] = "environment"
        output.write(("[controller] " + str(error) + "\n").encode("utf-8"))
    finally:
        if group:
            try:
                if process:
                    clean, residual = group.finish(process)
                    result["cleanup_confirmed"] = clean
                    if residual and result["failure_kind"] is None:
                        result["failure_kind"] = "orphaned_process"
                        output.write(b"\n[controller] residual child process detected and terminated\n")
                    if not clean:
                        result["failure_kind"] = "cleanup_incomplete"
                else:
                    result["cleanup_confirmed"] = True
            except (OSError, subprocess.SubprocessError) as error:
                result["failure_kind"] = "cleanup_incomplete"
                output.write(("[controller] cleanup incomplete: " + str(error) + "\n").encode("utf-8"))
            finally:
                group.close()
    result["status"] = "passed" if result["exit_code"] == 0 and not result["failure_kind"] \
        and result["cleanup_confirmed"] else "failed"
    return result
