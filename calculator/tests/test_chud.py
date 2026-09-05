import sys
from math import isqrt

if hasattr(sys, "set_int_max_str_digits"):
    sys.set_int_max_str_digits(0)

C = 426880
K1 = 545140134
K2 = 13591409
K3 = 640320
K3_CUBE = K3 ** 3


def pi_correct(digits):
    extra = 10
    scale = 10 ** (digits + extra)
    sqrt_10005 = isqrt(10005 * scale * scale)
    numerator = C * sqrt_10005

    n = int(digits / 14.1816) + 10
    D = K3_CUBE ** n

    M = 1
    L = K2
    D_current = D
    sign = 1
    S = L * D_current

    for k in range(1, n):
        M = M * 24 * (6 * k - 5) * (2 * k - 1) * (6 * k - 1) // (k ** 3)
        L += K1
        D_current //= K3_CUBE
        sign = -sign
        S += sign * M * L * D_current

    pi_scaled = (numerator * D) // S
    pi_str = str(pi_scaled)[:-extra]
    return f"{pi_str[0]}.{pi_str[1:]}"


print("100 digits:")
print(pi_correct(100)[:52])
print("1000 digits:")
print(pi_correct(1000)[:52])
